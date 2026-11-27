---
"@forestfuture/arbor": patch
---

On Postgres, text linked to a `real` or `decimal` key now links by the number it holds, with a point or an exponent (`"9.0"`, `"1e2"`), in a join, a through association and a counter cache, as it does on D1. Over a 4-byte `real` (`float4`) column, the text is read as a `real`, so `"0.1"` finds the value it rounds to. A `float4` real linked either way to a `double precision` real or a `decimal` is now compared at a `real`'s precision rather than by widening it, so `0.1` held at either width links. Text linked to an `integer` key is now compared so that Postgres searches the key's index.
