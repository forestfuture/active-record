---
"@forestfuture/active-record": minor
---

`upsert` and `upsertAll` take `updateOnly`, naming the only attributes a clashing row has updated: `upsertAll(rows, { uniqueBy: "email", updateOnly: ["name"] })`. An upsert now sets a clashing row's `updatedAt` only when a value it updates changes, so writing a row again as it was keeps its `updatedAt`. An upsert with nothing to update but `updatedAt` (every attribute it would update is a `uniqueBy` one or read-only) now leaves a clashing row alone, and doesn't count it in `rowsAffected` or return it in `rows`.
