import { Router, error_to_rick, no_cache } from "./common.ts"

export interface Env {

}

const router = new Router<Env>()

router.use("/", error_to_rick(404, 405))

router.get("/", no_cache(), async ctx => {
    const ip = ctx.headers.get("CF-Connecting-IP")
    const other_info = JSON.stringify(ctx.request.cf, null, 2)
    return new Response(`${ip}\n\n${other_info}`)
})

export default router.serve_cf()
