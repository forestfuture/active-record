---
"@forestfuture/arbor": patch
---

On Postgres, a preload or join from a `string` foreign key to an `integer` or `real` key now finds nothing for text with more than 308 digits past its leading zeros, where text with too many digits failed the whole query with `value overflows numeric format` or `out of range for type double precision`.
