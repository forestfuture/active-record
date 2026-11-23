---
"@forestfuture/active-record": minor
---

`upsert` and `upsertAll` take `updateOnly`, naming the only attributes a clashing row has updated: `upsertAll(rows, { uniqueBy: "email", updateOnly: ["name"] })`. An upsert now sets a clashing row's `updatedAt` only when a value it updates changes, so writing a row again as it was keeps its `updatedAt`.
