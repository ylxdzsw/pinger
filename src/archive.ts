import { Router, auth, KVNamespace, R2Bucket } from "./common.ts"

export interface Env {
	auth: KVNamespace
    r2: R2Bucket;
}

// TODO: listing recent / named pages and allow generating temporary public link
// TODO: add a "favourate" feature that stores the url of some favorate pages in a kv store so they can be more easily found.
const admin_page = `
    <input type="file" id="file"></input><br>
    <label for="url">URL:</label><input id="url"></input><br>
    <label for="title">Title:</label><input id="title"></input><br>
    <button id="submit">Take Snapshot</button><br>
    <span id="msg">You can also drag and drop a file to any box (but not on empty space)</span>
    <script>
        const $ = document.querySelector.bind(document)
        $("#submit").addEventListener("click", async () => {
            const data = {}
            if (window.file_to_upload)
                data.content = await window.file_to_upload.text()
            if ($("#title").value && $("#title").value.length)
                data.title = $("#title").value
            if ($("#url").value && $("#url").value.length)
                data.url = $("#url").value
            const req = await fetch("/", {
                method: "POST",
                body: JSON.stringify(data),
                credentials: "include"
            })
            $("#msg").textContent = await req.text()
        })
        $("#file").addEventListener("change", e => {
            const files = e.target.files
            if (files && files.length) {
                window.file_to_upload = files[0]
                $("#msg").textContent = "File To Upload"
            }
            $("#msg").textContent = "File To Upload"
        })
        $("body").addEventListener("drop", e => {
            e.preventDefault()
            const files = e.dataTransfer.files
            if (files && files.length) {
                window.file_to_upload = files[0]
                $("#msg").textContent = "File To Upload"
            }
        })
    </script>
`

// gather url and time information from captured page
function parse_snapshot_info(snapshot: string) {
    const url = snapshot.match(/^\s*url: (.*?)\s*$/m)?.[1]
    const date_str = snapshot.match(/^\s*saved date: (.*?)\s*$/m)?.[1]
    if (url == null || date_str == null)
        throw "Parsing Snapshot Info Failed. content:\n" + snapshot
    const timestamp = +new Date(date_str)

    return { url, timestamp }
}

const router = new Router<Env>()

router.use("/", auth("archive"), async (ctx, next) => {
    if (ctx.request.method != "GET")
        return await next()

    const target_url = ctx.request.url.slice(ctx.url.protocol.length + ctx.url.hostname.length + 3)
    if (target_url) {
        const object = await ctx.env.r2.get(target_url)

        if (object == null)
            return ctx.throw(404)

        const headers = new Headers()
        object.writeHttpMetadata(headers)
        headers.set('etag', object.httpEtag)

        return new Response(object.body, { headers })
    } else {
        return new Response(admin_page, {
            headers: {
                "content-type": "text/html"
            }
        })
    }
})

router.post("/", auth("archive"), async ctx => {
    const data: { title: string | null, url: string | null, content: string | null } = await ctx.request.json()
    if (data.url == null && data.content == null)
        return ctx.throw(400, "url or content is required")
    if (data.content == null)
        return ctx.throw(400, "Capturing is unavailable on serverless environment") // expore https://github.com/Y2Z/monolith ? it can be compiled to wasm (https://github.com/rhysd/monolith-of-web)

    try {
        const snapshot_info = parse_snapshot_info(data.content)
        const metadata: Record<string, string> = {
            url: snapshot_info.url,
            timestamp: snapshot_info.timestamp.toString()
        }
        if (data.title)
            metadata.title = data.title

        const object = await ctx.env.r2.put(metadata.url, data.content, {
            httpMetadata: {
                contentType: "text/html"
            },
            customMetadata: metadata
        })

        return new Response("OK: " + metadata.url)
    } catch (e) {
        console.error(e)
        return ctx.throw(500, "Failed to save snapshot")
    }
})

export default router.serve_cf()
