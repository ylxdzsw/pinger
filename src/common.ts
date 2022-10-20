import { getCookies } from "https://deno.land/std@0.159.0/http/cookie.ts"
import { IncomingRequestCf, KVNamespace, WorkerContextMethods } from 'https://raw.githubusercontent.com/skymethod/denoflare/v0.5.9/common/cloudflare_workers_types.d.ts'

export * from 'https://raw.githubusercontent.com/skymethod/denoflare/v0.5.9/common/cloudflare_workers_types.d.ts'

class Context<E> {
    [_: string | number | symbol]: unknown

    public params: Record<string, string>
    constructor(
        public readonly request: IncomingRequestCf,
        public readonly env: E,
        public readonly runtime: WorkerContextMethods,
    ) {
        this.params = {}
    }

    private _cookies?: Record<string, string>
    get cookies() {
        if (!this._cookies)
            this._cookies = getCookies(this.headers)
        return this._cookies
    }

    private _url?: URL
    get url() {
        if (!this._url)
            this._url = new URL(this.request.url)
        return this._url
    }

    get headers() {
        return this.request.headers
    }
}

export type Middleware<E> = (ctx: Context<E>, next: () => Promise<Response>) => Promise<Response>

class RoutingTree<E> {
    constructor (
        private name: string, // the name of the node, including the : prefix if exists
        public handlers: Record<string, Middleware<E>[]> = {},
        public children: Record<string, RoutingTree<E>> = {}, // match-all segments (starts with :) is saved with empty key
    ) {}

    route(ctx: Context<E>): Promise<Response> {
        const segments = ctx.url.pathname.split('/').filter(s=>s)
        return this._route(ctx, segments)
    }

    private _route(ctx: Context<E>, segments: string[], hooks: Middleware<E>[] = []): Promise<Response> {
        hooks.push(...this.handlers["*"] ?? [])
        if (segments.length === 0) {
            if (this.handlers[ctx.request.method]?.length)
                hooks.push(...this.handlers[ctx.request.method])
            else
                hooks.push(async () => new Response('Method not allowed', { status: 405 }))
        } else {
            const segment = segments.shift()!
            const child = this.children[segment] ?? this.children[""]
            if (child) {
                if (child.name.startsWith(':'))
                    ctx.params[child.name.slice(1)] = segment
                return child._route(ctx, segments, hooks)
            } else {
                hooks.push(async () => new Response('Not found', { status: 404 }))
            }
        }

        return this.run(ctx, hooks)
    }

    private run(ctx: Context<E>, middlewares: Middleware<E>[]) {
        let i = 0
        const next = () => {
            if (i >= middlewares.length)
                throw new Error('next() called at endpoint')
            return middlewares[i++](ctx, next)
        }
        return next()
    }

    add(method: string, path: string, ...handlers: Middleware<E>[]) {
        this._add(method, path.split('/').filter(s=>s), ...handlers)
    }

    private _add(method: string, segments: string[], ...handlers: Middleware<E>[]) {
        if (segments.length === 0) {
            if (this.handlers[method])
                throw new Error(`Duplicate route`)
            this.handlers[method] = handlers
        } else {
            const segment = segments.shift()!
            if (segment.startsWith(':') && this.children[""] && this.children[""].name != segment)
                throw new Error(`Two match-all paths with different parameter name`)
            const child_name = segment.startsWith(':') ? "" : segment
            this.children[child_name] ??= new RoutingTree(segment)
            this.children[child_name]._add(method, segments, ...handlers)
        }
    }
}

export class Router<E> {
    tree: RoutingTree<E>

    constructor() {
        this.tree = new RoutingTree("")
    }

    use(path: string, ...middlewares: Middleware<E>[]) {
        this.tree.add("*", path, ...middlewares)
    }

    get(path: string, ...middlewares: Middleware<E>[]) {
        this.tree.add("GET", path, ...middlewares)
    }

    head(path: string, ...middlewares: Middleware<E>[]) {
        this.tree.add("HEAD", path, ...middlewares)
    }

    post(path: string, ...middlewares: Middleware<E>[]) {
        this.tree.add("POST", path, ...middlewares)
    }

    put(path: string, ...middlewares: Middleware<E>[]) {
        this.tree.add("PUT", path, ...middlewares)
    }

    delete(path: string, ...middlewares: Middleware<E>[]) {
        this.tree.add("DELETE", path, ...middlewares)
    }

    serve_cf() {
        const router = this
        return {
            async fetch(request: IncomingRequestCf, env: E, runtime: WorkerContextMethods): Promise<Response> {
                return router.tree.route(new Context(request, env, runtime))
            }
        }
    }
}

export function auth(capability: string | null = null) {
    // note: Setting cookies to foreign domains will be silently ignored. So it works only for the site when debugging, but work for all sites when deployed
    const auth_page =`
        <input type="password"></input><button>Login</button><script>
        document.querySelector("button").addEventListener('click', () => {
            let cookie_str = "auth=" + encodeURIComponent(document.querySelector("input").value) + ";path=/;max-age=31536000"
            if (location.host.endsWith("ylxdzsw.com"))
                cookie_str += ";domain=ylxdzsw.com"
            document.cookie = cookie_str
            location.reload()
        })
        </script>
    `

    return async (ctx: Context<{ auth: KVNamespace }>, next: () => Promise<Response>): Promise<Response> => {
        const token = ctx.url.searchParams.get("token")
        if (capability && token) {
            const token_info = await ctx.env.auth.get(token, { type: "text" }) ?? ""
            if (token_info.includes(capability)) {
                return await next()
            }
        }

        const auth_cookie = ctx.cookies["auth"]
        if (auth_cookie) {
            const token_info = await ctx.env.auth.get(auth_cookie, { type: "text" }) ?? ""
            if ((capability && token_info.includes(capability)) || token_info.includes("__master__")) {
                return await next()
            }
        }

        if (token || auth_cookie)
            console.log("auth failed", { token, auth_cookie })

        return new Response(auth_page, {
            headers: {
                "cache-control": "no-cache",
                "content-type": "text/html",
            },
            status: 403
        })
    }
}

export function error_to_rick(...error_codes: number[]) {
    return async (_: unknown, next: () => Promise<Response>): Promise<Response> => {
        const response = await next()
        if (error_codes.includes(response.status))
            return new Response(null, {
                status: 301,
                headers: {
                    "location": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                }
            })

        return response
    }
}

export function no_cache() {
    return async (_: unknown, next: () => Promise<Response>): Promise<Response> => {
        const response = await next()
        response.headers.set("cache-control", "no-cache")
        return response
    }
}

export function compress_gzip(str: string) {
    const text_encoder = new TextEncoder()
    const encoded = text_encoder.encode(str)
    const gzip_encoder = new CompressionStream("gzip")
    const writer = gzip_encoder.writable.getWriter()
    writer.write(encoded).then(() => writer.close())
    return new Response(gzip_encoder.readable).arrayBuffer()
}
