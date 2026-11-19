---
"@forestfuture/active-record": patch
---

`Model.noTouching(fn)` (#496), as Rails' `no_touching`: inside `Article.noTouching(async () => { … })`, no article is touched, by a comment's `belongsTo(Article, { touch: true })` or by its own `touch()`, which writes nothing and resolves to `false`. It covers the Model and those extending it (`ApplicationRecord.noTouching` covers every Model), and only the code it runs, so other requests still touch. A save still sets its own `updatedAt`, and `touchAll` and the counters' `touch` option still write. Like `withDatabase`, it needs Node.js compatibility.
