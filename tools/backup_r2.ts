import { S3 } from "https://raw.githubusercontent.com/ylxdzsw/deno_s3/423f5a6bd801b94a029d7a21db4313bdd4359853/mod.ts"
import { Database } from "https://deno.land/x/sqlite3@0.6.1/mod.ts"
import * as flags from "https://deno.land/std@0.159.0/flags/mod.ts"

const cli_options = flags.parse(Deno.args)

if (cli_options._.length != 2) {
    console.info("Usage: backup [bucket-name] [path-to-sqlite]")
    Deno.exit(0)
}

const [bucket_name, db_path] = cli_options._ as string[]

const db = new Database(db_path)
db.exec("pragma journal_mode = wal")
db.exec("pragma synchronous = normal")
db.exec("pragma temp_store = memory")
db.exec("pragma foreign_keys = on")

db.exec(`
create table if not exists ${bucket_name}(
    key text primary key,
    value blob not null,
    compression_method text not null, -- "none" | "deflate-raw"
    last_modified text not null,
    etag text not null,
    content_type text not null,
    metadata text not null
) without rowid, strict
`)

const access_key = prompt("Access key ID:")
const secret_key = prompt("Secret Access Key:")
const endpoint_url = prompt("Endpoint URL:")

const s3 = new S3({
  accessKeyID: access_key!,
  secretKey: secret_key!,
  region: "auto",
  endpointURL: endpoint_url!
})

const bucket = s3.getBucket(bucket_name!)

const objects_iter = bucket.listAllObjects({
    batchSize: 100
})

const query = db.prepare(`select last_modified from ${bucket_name} where key = ?`)

for await (const object_info of objects_iter) {
    const last_modified_in_db = query.value<[string]>(object_info.key)?.[0]
    if (last_modified_in_db == object_info.lastModified!.toISOString()) {
        console.log("skip", object_info.key)
        continue
    }

    const object = await bucket.getObject(object_info.key!)
    const body = cli_options.compress ? object!.body!.pipeThrough(new CompressionStream("deflate-raw")) : object!.body!
    const content = await new Response(body).arrayBuffer()

    db.exec(`
        insert into ${bucket_name}(key, value, compression_method, last_modified, etag, content_type, metadata)
        values (:key, :value, :compression_method, :last_modified, :etag, :content_type, :metadata)
        on conflict(key) do update set
            value = excluded.value,
            compression_method = excluded.compression_method,
            last_modified = excluded.last_modified,
            etag = excluded.etag,
            content_type = excluded.content_type,
            metadata = excluded.metadata
    `, {
        key: object_info.key!,
        value: new Uint8Array(content),
        compression_method: cli_options.compress ? "deflate-raw" : "none",
        last_modified: object_info.lastModified!.toISOString(),
        etag: object_info.eTag!,
        content_type: object!.contentType!,
        metadata: JSON.stringify(object!.meta)
    })

    console.log("backup", object_info.key, cli_options.compress ? `(${content.byteLength} bytes compressed)` : `(${object_info.size} bytes)`)
}

export function compress_gzip(str: string) {
    const text_encoder = new TextEncoder()
    const encoded = text_encoder.encode(str)
    const gzip_encoder = new CompressionStream("gzip")
    const writer = gzip_encoder.writable.getWriter()
    writer.write(encoded).then(() => writer.close())
    return new Response(gzip_encoder.readable).arrayBuffer()
}
