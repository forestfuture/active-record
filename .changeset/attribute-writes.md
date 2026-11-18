---
"@forestfuture/active-record": patch
---

Change one attribute at a time (#351). A record's `increment("viewCount", by?)`, `decrement` and `toggle("isPinned")` change it in memory and return it. `updateColumns({ … })` and `updateColumn(name, value)` write straight to the row, with no validation, callback or `updatedAt`, and resolve to whether a row was written. `incrementColumn` and `decrementColumn` add to the row atomically (`SET x = COALESCE(x, 0) + ?`), so concurrent increments all count, and the record holds the row's new value; `toggleColumn` writes the flipped boolean. A Relation's `updateCounters({ viewCount: 1 })` adds to every row it matches in one statement, and `Post.updateCounters(ids, { … })`, `Post.incrementCounter("viewCount", ids, by?)` and `decrementCounter` write the rows with those primary keys. `record.isPreviouslyNewRecord()` says whether its last save created it, in its after-callbacks too.
