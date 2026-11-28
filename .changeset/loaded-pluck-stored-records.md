---
"@forestfuture/arbor": patch
---

On a loaded `hasMany`, `pluck`, `pick` and `ids()` now read stored records only, leaving out records built through the association, as a query does. A built record could read as `null` for its key or for an attribute it wasn't given, though `pluck` is typed by the attribute, so `pluck("id")` could resolve to `[10, null]` while typed `number[]`. On an unsaved owner, `pluck` now resolves to `[]` without a query, and `ids()` leaves out a built record even when its key was made in code. `pick` reads the first stored record, so a record built before one created through the association no longer hides it. To read built records' values, map over `toArray()`.
