---
"@forestfuture/arbor": patch
---

A `string` foreign key now reaches a `uuid` record only when it holds the UUID lowercase with hyphens, as joins and preloads already compared it. A belongsTo's read, a through association's read across it, its touch, its counter cache, and "must exist" no longer find the record by a key in capitals, braces, or without hyphens, and a preload no longer finds it because another record's key holds the UUID in its one form. A counter cache counts nothing in for text that isn't a UUID, where creating the record threw a `TypeError`. `find`, `findBy`, and `where` still take a UUID in any form. To keep keys written in another form linked, rewrite them once, for example with `UPDATE readings SET device_id = lower(device_id)` for capitals.
