---
"@forestfuture/active-record": patch
---

One project can hold databases on different adapters, such as a D1 database and a Postgres one. `active-record.jsonc` names each database's adapter, and every command uses that database's own: `schema` writes each schema through its adapter, and `g`, `migrate` and `console` use the adapter of the database `--database` names. `init --adapter postgresql` adds Hyperdrive bindings to a file that names only D1 databases. Outside a Worker, each Model finds the request's database on its own adapter.
