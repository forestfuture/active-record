---
"@forestfuture/active-record": patch
---

A `column()`, a typed value (`column(name).value(v)`) or `incoming()` given as an attribute's value now throws `TypeError` saying where it belongs. In a condition or `updateAll`, a `column()` or `incoming()` says to write it in an `sql` fragment, and a typed value says to give the value itself. It used to match nothing, store the reference as a json attribute's JSON, or throw a cast error that didn't say why. In a written row (`insert`, `upsert`, `createWith`) or a record (`build`, a setter, `update`), it says to give the value itself.
