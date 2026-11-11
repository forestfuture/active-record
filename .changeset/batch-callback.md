---
"@forestfuture/active-record": minor
---

A batch's writes are prepared in its callback (#332): `batch((b) => [b.save(user), b.destroy(post), b.insert(Log, { … }), b.updateAll(Post.where({ … }), { … }), b.deleteAll(user.posts())])`, and `db.batch` the same. `b` has a method for each write, named as the write is when it runs alone, taking a Model or a Relation first. A Model is written on the batch's database, so `db.model(…)` isn't needed inside `db.batch`. The callback can't await: one that doesn't return an array, and a `b` used after it has returned, throw a `TypeError` with nothing sent.

Breaking: the array form of `batch` and `db.batch` is removed, along with the `to…` methods (`toInsert`, `toInsertAll`, `toUpsert`, `toUpsertAll`, `toUpdateAll` and `toDeleteAll`, on Relations and as Model statics) and records' `toSave()` and `toDestroy()`. A prepared write no longer has `toSql()`; `onQuery` shows what a batch sent. Replace `batch([user.toSave(), Post.where(…).toDeleteAll()])` with `batch((b) => [b.save(user), b.deleteAll(Post.where(…))])`.
