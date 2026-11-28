---
"@forestfuture/arbor": patch
---

On Postgres, `insertAll` and `upsertAll` now write to a table named like one of Postgres's own types, such as `point`, `path` or `money`, json attributes included. They failed before, since Postgres read the table's name as its own type's.
