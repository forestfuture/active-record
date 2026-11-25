---
"@forestfuture/arbor": minor
---

An upsert whose `uniqueBy` names an index other than the primary key no longer changes a clashing row's primary key when its rows give one. The row keeps its own primary key, and `rows` returns it. When the primary key is all the upsert would update, the row is left alone and isn't counted or returned. Naming the primary key in `updateOnly` or `onDuplicate` with such a `uniqueBy` throws `TypeError`. To change a row's primary key, use `updateAll`.
