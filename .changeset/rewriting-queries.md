---
"@forestfuture/active-record": patch
---

Rewriting queries (#350), on a Relation and as Model statics. `rewhere(conds)` replaces the conditions on the attributes it names, a default scope's included. `unscope("where" | "order" | "limit" | …)` drops parts of a query, and `unscope({ where: "role" })` the conditions on attributes; `merge` carries an unscope onto the Relation merged into. `only(...)` keeps only the parts named. `inOrderOf("status", ["open", "paid"])` orders by a list of values, keeping only those unless `{ filter: false }`, with the list bound as one value so any length fits. `excluding(...records)` leaves records out by primary key. `hasMoreThanOne()` and `hasExactlyOne()` count up to two records, answering from a loaded association without a query. An adapter's `Dialect` gains `placeInList`.
