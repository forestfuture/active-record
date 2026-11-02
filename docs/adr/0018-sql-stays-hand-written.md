# SQL stays hand-written, behind a dialect seam

The compiler keeps writing its own SQL, and a small dialect supplies what differs between databases: list conditions, pagination and bulk inserts (#260). Numbered placeholders and a `COUNT` subquery alias are handled in one place. The compiler stays the only module that writes SQL.

We prototyped the alternative: a third-party query builder used only to compile SQL, with the library's own executor. It returned the same rows on every query we compared, and it would have given us each database's quoting and placeholders. It didn't pay for itself. It meant rewriting a compiler that already works, and the parts that differ most still needed database-specific raw SQL: a list has to stay one bound value to fit D1's limit of 100 bound parameters, and bulk inserts need the same. With D1 and Postgres as the only targets, little of the difference it would absorb is left. The dialect seam took about 50 lines, and every D1 integration test still passed.

## Consequences

- **We own each dialect.** A new database means writing one, which is a small cost for a database as close as Postgres, and a larger one for MySQL.
- **SQL text doesn't change for D1**, apart from the subquery alias, so `toSql()`, `onQuery` and the tests that read them are undisturbed.
- **No dependency on a pre-1.0 package** in the core.
- **Open to change.** The seam is internal, so a query builder could still go behind it if a later database justified one.
