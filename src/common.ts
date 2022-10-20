import { getCookies } from "https://deno.land/std@0.159.0/http/cookie.ts"
import { KVNamespace } from 'https://raw.githubusercontent.com/skymethod/denoflare/v0.5.9/common/cloudflare_workers_types.d.ts'

export * from 'https://raw.githubusercontent.com/skymethod/denoflare/v0.5.9/common/cloudflare_workers_types.d.ts'

export type Handler<T> = (request: Request, env: T, next: () => Promise<Response>) => Promise<Response>

export class Router<T> {
    // todo: path segmentation and actual routing
    table: Record<string, Handler<T>[]>

    constructor() {
        this.table = Object.create(null)
    }

    get(path: string, ...middlewares: Handler<T>[]) {
        this.table["GET"] = middlewares
    }

    head(path: string, ...middlewares: Handler<T>[]) {
        this.table["HEAD"] = middlewares
    }

    post(path: string, ...middlewares: Handler<T>[]) {
        this.table["POST"] = middlewares
    }

    put(path: string, ...middlewares: Handler<T>[]) {
        this.table["PUT"] = middlewares
    }

    delete(path: string, ...middlewares: Handler<T>[]) {
        this.table["DELETE"] = middlewares
    }

    async handle(request: Request, env: T): Promise<Response> {
        function make_rec<T>(request: Request, env: T, middlewares: Handler<T>[]): () => Promise<Response> {
            const [first, ...rest] = middlewares
            return () => first(request, env, make_rec(request, env, rest))
        }

        const middlewares = this.table[request.method]
        if (middlewares == null) {
            return new Response(null, { status: 405 })
        }
        return make_rec(request, env, middlewares)()
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
    return async (request: Request, env: { auth: KVNamespace }, next: () => Promise<Response>): Promise<Response> => {
        const token = new URL(request.url).searchParams.get("token")
        if (capability && token) {
            const token_info = await env.auth.get(token, { type: "text" }) ?? ""
            if (token_info.includes(capability)) {
                return await next()
            }
        }

        const auth_cookie = getCookies(request.headers)["auth"]
        if (auth_cookie) {
            const token_info = await env.auth.get(auth_cookie, { type: "text" }) ?? ""
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

export function compress_gzip(str: string) {
    const text_encoder = new TextEncoder()
    const encoded = text_encoder.encode(str)
    const gzip_encoder = new CompressionStream("gzip")
    const writer = gzip_encoder.writable.getWriter()
    writer.write(encoded).then(() => writer.close())
    return new Response(gzip_encoder.readable).arrayBuffer()
}

export function error_to_rick(...error_codes: number[]) {
    return async (request: Request, env: {}, next: () => Promise<Response>): Promise<Response> => {
        const response = await next()
        if (error_codes.includes(response.status))
            return Response.redirect("https://www.youtube.com/watch?v=dQw4w9WgXcQ", 301)
        else
            return response
    }
}
