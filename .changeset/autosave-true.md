---
"@forestfuture/active-record": patch
---

`autosave: true` on a `hasMany`, `hasOne` or `belongsTo` (#37): saving the owner also saves the association's loaded records that changed, and destroys those marked with `record.markForDestruction()` (`isMarkedForDestruction()` reads the mark, and `reload()` clears it). A changed record's errors are copied onto the owner under the association's name, such as `posts.title` ("Posts title can't be blank"). A marked record is destroyed with its callbacks and `dependent:` strategies, and leaves the loaded association. A `belongsTo`'s marked record is destroyed after the owner stops pointing at it. On the owner's database, it's all one atomic batch when the owner's key is known.
