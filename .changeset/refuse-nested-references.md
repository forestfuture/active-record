---
"@forestfuture/active-record": patch
---

A `column()`, a typed value or `incoming()` given as `find`'s id, or one of its ids, now throws `TypeError` saying to give the value itself, instead of `RecordNotFound`.

One nested in a json value (`where({ settings: { theme: column("x") } })`, `build`, `update`, `updateAll`, `insert`, or a value changed in place and saved) now throws the same `TypeError`, naming its path (`settings.theme`). It used to match or store the reference's JSON.
