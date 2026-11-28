---
"@forestfuture/arbor": patch
---

On Postgres, a `decimal` key linked to a `double precision` real that a `double precision` can't hold, such as `1e400` or `1e-400`, now links nothing, in a join, a through association and a counter cache, rather than failing the query with `out of range for type double precision`.
