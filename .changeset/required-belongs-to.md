---
"@forestfuture/active-record": minor
---

A `belongsTo` requires its record (#339): saving a record whose `belongsTo` points at nothing fails validation with "must exist" (type `required`) on the association. It's checked when the foreign key is `null` or has changed, and the record found stays loaded. A record built through its owner's `hasMany` or `hasOne` points back at the owner, so it passes before either is saved, and `await post.author()` on it is the owner without a query.

Breaking: add `optional: true` to each `belongsTo` whose foreign key may be `null`: `parent = belongsTo(Category, { optional: true })`.
