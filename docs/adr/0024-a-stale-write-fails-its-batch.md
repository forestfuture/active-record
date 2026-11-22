# A stale write fails its batch

Optimistic locking (#357) refuses a save, destroy or `touch()` of a record whose row another write changed since it was loaded: the write matches the record's `lockVersion` as well as its key, and matching no row means the record is stale. A stale write must leave nothing behind, but it's sent in one atomic batch with the rest of its record's write: its dependents' deletes before it, its counter caches and touches around it, its autosaved records, and in a `db.batch`, other records altogether. On Postgres the batch is a transaction, but D1's `db.batch` has no rollback a caller can ask for halfway: it commits unless one of its statements fails.

So each adapter's dialect sends a guard with a locked write, which fails the batch when the write changed no row. On D1 it's a `SELECT` right after the write: `json_extract('{}', CASE WHEN changes() = 0 THEN ? ELSE '$' END)`, which fails with a JSON path that isn't one when `changes()` says the write changed nothing. On Postgres the write becomes a CTE, `WITH locked AS (… RETURNING 1)`, and the statement casts a marker to an integer when it returned no row. Either error repeats the bound marker, which names the write, so the core throws `StaleRecord` for that record in place of the database's error.

Rails raises `StaleObjectError` inside the transaction it wraps every save in, which rolls the rest back. Reading each write's affected rows after the batch was weighed: it's simpler SQL, but the batch would already be committed, so the stale record's dependents and the other records of a `db.batch` would be written. Sending the locked write in a batch of its own first was weighed too: it isn't atomic with the rest, and it costs a round trip.

## Consequences

- **One more statement per locked write on D1**, in the same batch, so no round trip; Postgres sends one statement. `onQuery` reports the guard like any other statement.
- **The guard fails the batch on purpose**, with an error that looks like a mistake in SQL. It's recognized by its marker only, so it's never mistaken for another failure, and an app sees `StaleRecord`.
- **Postgres keeps the marker in its error message.** Messages of SQLSTATE class 22 have the value they refused filtered, so no app value reaches a log (#269); the guard's refusal, whose value is the library's marker, is the one kept.
- **Each adapter writes its own guard**, through the dialect's `staleGuard`, so a new adapter must have a way to fail a batch on a statement's outcome.
