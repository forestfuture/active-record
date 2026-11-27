---
"@forestfuture/arbor": patch
---

On Postgres, destroying a record or changing its key no longer fails with `operator does not exist` when its counter cache links a `string` foreign key to an `integer`, Unix-time or `uuid` key. The same holds for a `uuid` foreign key linked to a `string` key. The record is counted out of its target by the comparison a join uses.
