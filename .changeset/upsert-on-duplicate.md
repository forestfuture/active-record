---
"@forestfuture/active-record": patch
---

`upsert` and `upsertAll` take `onDuplicate`, saying what a clashing row's attributes become, each an `sql` fragment or a value: ``upsertAll(rows, { uniqueBy: "name", onDuplicate: { count: sql`${column("count")} + ${incoming("count")}` } })``. In its fragments, `column()` is the clashing row's value, and the new `incoming()` is the new row's.
