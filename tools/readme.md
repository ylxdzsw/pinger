## backup r2 bucket

Incrementally backup (based on last modified time) a bucket into an SQLite database

```sh
deno run -A --unstable backup_r2.ts [bucket_name] backup.sqlite [--compress]
```

Vacuum the database

```sh
sqlite3 backup.sqlite 'vacuum; pragma wal_checkpoint(truncate)'
```

