# The portable API is what every adapter can do, and the rest comes from the adapter

Anything imported from `@forestfuture/active-record` works on every adapter (#260). A feature only one database has is exported by that adapter's package: `withSession` from `d1-record`, and later `transaction` from `pg-record`. Adapters may report internal capabilities to the core, but apps never branch on them.

We chose this over a `Database` type generic over its capabilities, and over methods that exist everywhere and throw where they aren't supported. A generic would spread through `Model` and `Relation` for little gain, and a throwing method moves a compile-time fact to production. An adapter's import also makes lock-in easy to find: search for it.

D1 sets the limit. It has no interactive transactions, only `batch()`, so a portable atomic write is a list of statements declared up front. That maps to `BEGIN … COMMIT` on Postgres, while a `transaction(async () => { … })` block can't map back to D1. So the batch stays the portable transaction. A block that queued writes and sent them at the end would look portable, but `save()` would resolve before anything was written, which breaks ADR-0009.

Adapters promise the same API and contract behavior, not identical results. Each database keeps its own semantics, such as NULL ordering and `LIKE` case-sensitivity. Normalizing them would fight indexes and never end, and Rails leaves them too.

## Consequences

- **Allowed differences are written down.** The conformance suite holds the list, and each adapter's docs repeat it.
- **Raw `sql` fragments aren't portable** (ADR-0006). A fragment using one database's functions stays there.
- **Atomicity differs in one place.** With keys the database assigns, a save with autosaves writes in stages on D1, and a failed stage leaves the earlier ones written. Postgres can run the stages in one transaction. Keys made in code (ADR-0013) stay the way to get an atomic save everywhere.
- **A Postgres batch gets its own client.** On a shared client, a concurrent write joins the batch's transaction, reports success, and is lost in a rollback.
- **Read batches are plain queries on Postgres**, since Hyperdrive holds a connection for a transaction's length. "One round trip" is a `d1-record` promise, and a `paginate` count can briefly disagree with its rows on Postgres.
