---
"@forestfuture/active-record": patch
---

Work through a large table a batch at a time (#347): `for await (const user of User.where({ … }).findEach())` loads the records 1,000 at a time in primary-key order, each batch one query that starts after the last batch's key. `findInBatches()` yields each batch as an array, and `inBatches()` as a Relation, so `updateAll`, `deleteAll` and `destroyAll` can write one batch at a time. Each takes `batchSize`, `start` and `finish` (primary keys, both included), and `order: "desc"`, and honors a `limit()`. A Relation with its own order (a default scope's too), or an `offset()`, throws `IncompatibleRelation`: remove the order with `reorder()`.
