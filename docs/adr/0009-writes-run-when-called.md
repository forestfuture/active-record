# Writes run when called; `to…` forms prepare them for a batch

**Superseded in part by ADR-0020** (#332): a batch's writes are prepared in its callback, `batch((b) => [b.insert(Post, …), b.save(user)])`, and the `to…` forms below are gone. Writes still run when called.

**Amended by ADR-0016** (#266): the insert family resolves to `{ rowsAffected, rows }`, each written row's `returning` attributes (the primary key by default), not D1's `meta`, and a batch's statements resolve to the same.

A Relation's bulk writes run when they're called, as Rails' do: `await posts.deleteAll()` and `updateAll(…)` resolve to the number of rows, and `insert`, `insertAll`, `upsert` and `upsertAll` to D1's `meta`. Each has a `to…` form (`toInsert`, `toUpdateAll`, `toDeleteAll`, …) that returns a Statement for `db.batch([...])` instead of running it, as records have `save()` and `toSave()`. One rule covers both: methods do things, and `to…` methods hand you the thing to do, for a batch.

Before this, the bulk writes only built a Statement, which ran with `.run()` or in a batch. That kept a single way to build any write, and was safe: Statements aren't awaitable, so an `async` function that returns one never runs it. But it surprised people coming from Rails, where `delete_all` runs, and `.run()` had to be looked up. Making Statements awaitable would have removed `.run()`, but brought back the accident: awaiting, or returning from an `async` function, a write that was meant for a batch would run it on its own.

## Consequences

- **Return values:** `deleteAll`/`updateAll` resolve to a count, as in Rails; anyone who wants D1's full `meta` for one gets it from `onQuery` or a batch's results. The insert family resolves to `meta`, which carries `last_row_id`.
- **`none()`:** `deleteAll`/`updateAll` send nothing and resolve to `0`, as in Rails. Its `to…` statements are still sent with their batch, as `WHERE 1 = 0`, since a batch entry needs something to send.
- **When errors arrive:** the immediate forms are `async`, so an unknown attribute or a refused write rejects their promise. The `to…` forms throw when the statement is built, as before.
- **Loaded collections:** writing through a loaded `hasMany` clears it when the write is prepared, and again once an immediate write lands, so a read sent before or while the write is in flight can't leave old rows cached.
- **Statements** are only ever batch entries now: they have no methods of their own and are never awaitable.
