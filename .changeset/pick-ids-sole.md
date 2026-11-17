---
"@forestfuture/active-record": minor
---

Small finders (#349). `pick("email")` reads one attribute from the first record in the Relation's order (`LIMIT 1`), or a tuple with several (`pick("id", "email")`), and resolves to `null` when nothing matches. `ids()` plucks the primary keys in the Relation's order. `sole()` resolves to the only matching record, and throws `RecordNotFound` when none matches and the new `SoleRecordExceeded` ("Wanted only one User") when more than one does; `findSoleBy(conditions)` is `where(conditions).sole()`. `firstOrThrow()`, `lastOrThrow()` and `takeOrThrow()` throw `RecordNotFound` where `first()`, `last()` and `take()` resolve to `null`. On a loaded `hasMany`, each answers from the loaded records without a query. Each is also a static of every Model.
