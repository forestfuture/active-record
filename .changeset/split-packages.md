---
"@forestfuture/active-record": minor
"@forestfuture/d1-record": minor
---

The library is now two packages, both breaking changes. `@forestfuture/active-record` is the core, and `@forestfuture/d1-record` is its D1 adapter. Install both. The guide's [Upgrading to 0.6](https://d1-record.forestfuture.dev/upgrading) walks through the move.

- Import Models, Relations, validations, callbacks, associations, `withDatabase`, `batch` and the error classes from `@forestfuture/active-record`. Import `connect`, `withSession`, `NoSession`, `d1`, and D1's `QueryEvent` and `QueryListener`, from `@forestfuture/d1-record`. `d1-record` re-exports nothing of the core.
- The generated schema names its adapter: `adapter: d1({ binding: "DB" })` replaces `binding: "DB"`. Run `npx active-record schema` to regenerate it.
- `toSql()` on a Model with no generated schema, outside `withDatabase` and with no `db`, throws `NoDatabase`, since nothing says which database's SQL to write.
- The agent skill is now `active-record`, in `@forestfuture/active-record`, which ships `llms-full.txt` too.
