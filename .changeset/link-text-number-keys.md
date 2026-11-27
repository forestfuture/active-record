---
"@forestfuture/arbor": patch
---

On Postgres, text linked to a `real` or `decimal` key now links by the number it holds, with a point or an exponent (`"9.0"`, `"1e2"`), in a join, a through association and a counter cache, as it does on D1. Text linked to an `integer` key is now compared so that Postgres searches the key's index.
