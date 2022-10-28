import { Router, auth, KVNamespace } from "./common.ts"

export interface Env {
	auth: KVNamespace,
    kv: KVNamespace
}

const page = `
<p><label>URL:<input id="url"/></label>
<p><label>Expire (day):<input type="number" value="3" id="exp"/></label>
<p><button>Get Link</button>
<p id="result">
<script>
document.querySelector('button').addEventListener('click', async () => {
    const url = document.querySelector('#url').value
    const expire = parseInt(document.querySelector('#exp').value)
    const res = await fetch('/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url, expire })
    })
    document.querySelector("#result").textContent = await res.text()
})
</script>
`

const router = new Router<Env>()

router.get("/", auth("url"), async ctx => {
    return new Response(page, {
        headers: {
            "content-type": "text/html"
        }
    })
})

router.get("/:id", async ctx => {
    const url = await ctx.env.kv.get(ctx.params.id)
    return url
        ? Response.redirect(url, 302)
        : ctx.throw(404)
})

router.post("/", auth("url"), async ctx => {
    const { url, expire } = await ctx.request.json()
    for (let retry = 0; retry < 3; retry++) { // remember that KV is eventually consistent. We assume only one writer (me) at a time.
        const r = crypto.getRandomValues(new Uint8Array(3))
        const id = btoa(String.fromCharCode(...r)).replace(/\//g, "_").replace(/\+/g, "-")

        if (await ctx.env.kv.get(id))
            continue

        if (expire && !isNaN(expire) && expire > 0)
            await ctx.env.kv.put(id, url, { expirationTtl: expire * 24 * 60 * 60 })
        else
            await ctx.env.kv.put(id, url)

        return new Response(new URL(id, ctx.url.href).href)
    }

    return ctx.throw(500, "Failed to generate a unique id")
})

export default router.serve_cf()
