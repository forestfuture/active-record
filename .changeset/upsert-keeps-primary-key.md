---
"@forestfuture/arbor": minor
---

An upsert whose `uniqueBy` names an index other than the primary key no longer changes a clashing row's primary key when its rows give one: the row keeps its own, and `rows` returns it. Naming the primary key in `updateOnly` or `onDuplicate` with such a `uniqueBy` throws `TypeError`. To change a row's primary key, use `updateAll`.
