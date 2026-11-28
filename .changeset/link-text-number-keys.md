---
"@forestfuture/arbor": patch
---

On Postgres, a `float4` real linked either way to a `double precision` real or a `decimal` is now compared at a `real`'s precision rather than by widening it, so `0.1` held at either width links. A `real` of either width linked to a `decimal` is now compared as the text it reads as, so Postgres searches the decimal's index.
