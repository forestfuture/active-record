---
"@forestfuture/arbor": patch
---

On Postgres, a preload or join from a `string` foreign key to an `integer` key now finds nothing for text with more digits than any number holds, where it failed the whole query with `value overflows numeric format`.
