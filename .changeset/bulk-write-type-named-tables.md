---
"@forestfuture/arbor": patch
---

On Postgres, `insertAll` and `upsertAll` now write to a table named like one of Postgres's own types, such as `point`, `path` or `money`. They used to fail with a type error. A bulk write now needs the `SELECT` privilege on its table as well as `INSERT`.
