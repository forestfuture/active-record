---
"@forestfuture/active-record": patch
---

`g model` and `g migration` name a new migration for the UTC second it's written in (`20261108090503_create_products.sql`), on D1 too, so migrations written on two branches don't clash. Wrangler orders D1's migrations by their leading number, so files numbered `0001_…` still run first. The command reads a project's `active-record.jsonc`, which Postgres projects declare their databases in. A plugin for the command (`@forestfuture/active-record/cli`, unstable) returns a migration's SQL and notes while the command names its file, reads a schema with its database's config entry, and shares the core's helpers for reading tables, migration names and JSON with comments.
