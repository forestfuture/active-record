---
"@forestfuture/active-record": patch
---

Validate a batched save in a context of your own: `b.save(record, { context: "signup" })`, as `save({ context })` does (#420). A context the record's Model doesn't list throws `TypeError` from `b.save`.
