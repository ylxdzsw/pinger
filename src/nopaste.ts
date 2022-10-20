import { Router } from "./common.ts"

export interface Env {

}

const router = new Router<Env>()

const page = `
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<script src="https://r2.ylxdzsw.com/sd-streams-polyfill.min.js"></script>
<p><label>Password: <input></input></label>
<p><textarea rows=10 cols=50 style="font: .9em monospace"></textarea>
<pre><a></a></pre>
<script>
function throttle(f) {
    let state = 0
    function throttled() {
        if (state == 0) f().finally(() => {
            if (state >= 2) setTimeout(throttled, 0)
            state = 0
        })
        state++
    }
    return throttled
}
const get_counter = (nonce, msg_len) => new Uint8Array([...nonce, 0, 0, ~~(msg_len/256)%256, msg_len%256, 1, 2, 3, 4, 0, 0, 0, 0])
async function gen_link() {
    const text = document.querySelector("textarea").value
    const encoded = new TextEncoder().encode(text)
    const compressor = new CompressionStream("deflate-raw")
    const writer = compressor.writable.getWriter()
    writer.write(encoded).then(() => writer.close())
    let to_encode = await new Response(compressor.readable).arrayBuffer()
    const key = await get_key()
    if (key) {
        const nonce = crypto.getRandomValues(new Uint8Array(4))
        const encrypted = await crypto.subtle.encrypt({ name: "AES-CTR", length: 64, counter: get_counter(nonce, to_encode.byteLength) }, key, to_encode)
        to_encode = [...nonce, ...new Uint8Array(encrypted)]
    }
    const link = new URL('', location.href).href + '#' + btoa(String.fromCharCode(...new Uint8Array(to_encode)))
        .replace(/\\+/g, "-")
        .replace(/\\//g, "_")
        .replace(/=/g, "")
    document.querySelector("pre>a").href = link
    document.querySelector("pre>a").textContent = link
}
let key_cache = [null, null]
async function get_key() {
    const password = document.querySelector("input").value
    if (!password) return null
    if (key_cache[0] == password) return key_cache[1]
    const base_key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"])
    const key = await crypto.subtle.deriveKey({
        name: "PBKDF2",
        salt: new Uint8Array([109, 111, 51, 57]),
        iterations: 201025,
        hash: "SHA-256"
    }, base_key, { name: "AES-CTR", length: 256 }, false, ["encrypt", "decrypt"])
    key_cache = [password, key]
    return key
}
async function decode() {
    try {
        const compressed = new Uint8Array(atob(location.hash.slice(1)
            .replace(/-/g, "+")
            .replace(/_/g, "/"))
            .split("")
            .map(c => c.charCodeAt(0)))
        const key = await get_key()
        const to_decode = key
            ? await crypto.subtle.decrypt({ name: "AES-CTR", length: 64, counter: get_counter(compressed.slice(0, 4), compressed.length - 4) }, key, compressed.slice(4))
            : compressed
        const decompressor = new DecompressionStream("deflate-raw")
        const writer = decompressor.writable.getWriter()
        writer.write(to_decode).then(() => writer.close())
        const text = await new Response(decompressor.readable).text()
        document.querySelector("textarea").value = text
    } catch (e) {
        document.querySelector("textarea").value = "Decoding failed (It may be encrypted)."
    }
}
if (location.hash.length > 1) {
    document.querySelector("input").addEventListener("input", throttle(decode))
    decode()
} else {
    document.querySelector("textarea").addEventListener("input", throttle(gen_link))
    document.querySelector("input").addEventListener("input", throttle(gen_link))
}
</script>
`

router.get("/", async ctx => {
    return new Response(page, {
        headers: {
            "content-type": "text/html",
        },
    })
})

export default router.serve_cf()
