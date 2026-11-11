# Batch writes are prepared in a callback, not by `to…` methods

A batch's writes are prepared inside its callback (#332): `batch((b) => [b.save(user), b.insert(Log, { … }), b.deleteAll(user.posts())])`, and `db.batch` the same. `b` is a `Batch`, with a method named after each write: `insert`, `insertAll`, `upsert`, `upsertAll`, `updateAll` and `deleteAll`, each taking what it writes to (a Model or a Relation) and then the write's own arguments, plus `save` and `destroy` for a record. The callback returns its writes as an array, and they're sent together once it has returned.

ADR-0009 gave each write a `to…` form instead (`toInsert`, `toUpdateAll`, `toSave()`, …), passed to `batch([...])`. Its rule was that methods do things and `to…` methods hand you the thing to do. The prefix didn't say that. Everywhere else in JavaScript `to…` converts (`toString`, `toJSON`, `toSorted`), and on the same Relation `toArray()` runs a query while `toSql()` only shows one. The guide had to explain each `to…` method with the word "prepares". The callback names each write with the verb it already has when it runs alone, and reads as a block of writes that happen together, as a transaction block does.

`prepare…` names (`prepareInsert`, `prepareSave()`) were weighed too. They'd say what the methods do, but double the API's names. The callback keeps one name per write, and a write can only be prepared where it will be sent, so one can't be built and then forgotten.

## Consequences

- **Supersedes ADR-0009's `to…` forms.** Writes still run when called, and Statements still have no `then`.
- **The callback can't await.** D1 can't hold a batch open while code awaits, so the callback's type refuses a Promise, and anything but an array rejects with a `TypeError` before anything is sent. A `Batch` used after its callback has returned throws, so a write prepared late isn't silently left out.
- **A Model is written on the batch's database:** `db` for `db.batch`, the current database for `batch`. `db.model(…)` isn't needed inside a callback. A Relation or record still writes on the database it came from, and two databases are still `IncompatibleRelation`.
- **A Statement has no `toSql()`.** It only exists inside a callback, so its SQL couldn't be read without sending its batch. `onQuery` reports what was sent. `Relation#toSql()` stays.
- **A breaking release, with no aliases** (pre-1.0): the array form of `batch`, the six bulk `to…` methods with their Model statics, and records' `toSave()`/`toDestroy()` are removed.
