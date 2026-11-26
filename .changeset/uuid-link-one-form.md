---
"@forestfuture/arbor": patch
---

A `string` foreign key now reaches a `uuid` record only when it holds the UUID lowercase with hyphens, wherever it's followed, on both databases. A belongsTo's read, its touch, its counter cache and "must exist" found the record by a key in another form (capitals, braces, no hyphens), and a preload did whenever another record's key held it in its one form, while a join and a preload alone found nothing. Now none finds it, and a counter cache counts nothing in for text that isn't a UUID, where creating the record threw a `TypeError`. `find`, `findBy` and `where` still take a UUID in any form. On D1, rewrite foreign keys held in another form once, for example with `UPDATE readings SET device_id = lower(device_id)` for capitals.
