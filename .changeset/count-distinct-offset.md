---
"@forestfuture/active-record": patch
---

`count(attribute)` after `distinct()` with a `limit` or `offset` counts the distinct values they pick, as `pluck(attribute)` returns them. It counted the distinct values left in that many rows.
