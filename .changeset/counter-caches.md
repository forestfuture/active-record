---
"@forestfuture/active-record": patch
---

Counter caches (#61): `article = belongsTo(Article, { counterCache: true })` keeps a `commentsCount` on each article, changed in the same atomic batch as each comment's insert, destroy or move to another article, and by a hasMany's `delete`, `clear` and `deleteAll()`; bulk writes leave it alone. `counterCache: "replyCount"` names the attribute, and `{ active: false }` keeps it without reading it while it's filled in. `article.comments().size()`, `isEmpty()` and `hasAny()` read it without a query; a hasMany reads the counter named for it, or the one its own `counterCache` names. Removing records through an association through another counts out its join records. `Article.resetCounters(id, "comments")` sets it from the rows. The counter statics take `{ touch }`, which sets `updatedAt` in the same statement, `incrementCounter` and `decrementCounter` take `{ by }`, and a batch has `b.updateCounters`.
