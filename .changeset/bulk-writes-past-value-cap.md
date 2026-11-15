---
"@forestfuture/active-record": patch
---

On D1, `insert`, `insertAll`, `upsert` and `upsertAll` take rows of any size (#392). Rows larger than D1's 2 MB limit on one bound value go as several statements in one atomic batch, and resolve to one result. A row too large on its own binds its values as `create` does. Adapters can set `maxValueBytes` on their dialect to cap one bound value.
