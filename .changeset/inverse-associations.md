---
"@forestfuture/active-record": patch
---

Inverse associations (#62). A record loaded through its owner's `hasMany` or `hasOne`, by the association, its finders, a Relation narrowed from it, or `includes`, has the owner loaded as its `belongsTo`, the same object, so `await post.author()` sends no query. Through an `autosave: true` belongsTo, saving such a record now also saves the owner's unsaved changes, since the owner is loaded. A `belongsTo`'s record, read or preloaded, has the owner as its inverse `hasOne`. A record built through a new owner keeps pointing back after saving fills in its foreign key. The inverse is inferred by foreign key, so it's found with a `foreignKey:` option too; name it with `inverseOf: "author"` (on an association with a `scope:`, for one), or turn it off with `inverseOf: false`. A wrong `inverseOf` is `InvalidModel` when the Model is first used.
