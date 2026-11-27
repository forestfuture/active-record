---
"@forestfuture/arbor": patch
---

On Postgres, destroying a record, or changing its key, no longer fails with `operator does not exist` when its counter cache links a `string` foreign key to an `integer`, Unix-time or `uuid` key (or a `uuid` foreign key to a `string` one). It counts the record out of its target as a join links them.
