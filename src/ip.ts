import { IncomingRequestCf, WorkerContextMethods, Router, error_to_rick } from "./common.ts"

export interface Env {

}

export default {
    async fetch(request: IncomingRequestCf, env: Env, ctx: WorkerContextMethods): Promise<Response> {
        const ip = request.headers.get("CF-Connecting-IP")
        const other_info = JSON.stringify(request.cf, null, 2)
        return new Response(`${ip}\n\n${other_info}`, {
            headers: {
                "cache-control": "no-cache"
            }
        })
    }
}
