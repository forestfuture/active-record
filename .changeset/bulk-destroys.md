---
"@forestfuture/active-record": patch
---

Destroy many records at once (#348). `destroyAll()` on a Relation loads its records and destroys them in one write, with their callbacks and `dependent:` strategies, or throws `RecordNotDestroyed` and destroys none if one refuses. `destroyBy(conditions)` and `deleteBy(conditions)` destroy or delete what `where(conditions)` matches. `Post.destroy(id | ids)` and `Post.delete(id | ids)` do the same by primary key. On a `hasMany`, `user.posts().destroyAll()` destroys every record whatever its `dependent:`, and leaves the association empty.
