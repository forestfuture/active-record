---
"@forestfuture/active-record": patch
---

A `column()`, a typed value or `incoming()` given as `find`'s id, or one of its ids, now throws `TypeError` saying to give the value itself, instead of `RecordNotFound`.
