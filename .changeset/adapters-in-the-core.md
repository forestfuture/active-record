---
"@forestfuture/active-record": minor
---

The adapters now ship inside `@forestfuture/active-record`, so an app installs one package. Import what opens D1 from `@forestfuture/active-record/d1` (`connect`, `withSession`, `NoSession`, `d1`), and uninstall `@forestfuture/d1-record`, which gets no new version. The PostgreSQL adapter is `@forestfuture/active-record/postgresql` (`connect`, `postgresql`), with your own `pg`; `pg` and PGlite are optional peer dependencies, so a D1 app installs neither.

Every `active-record` command now reads `active-record.jsonc`, which names each of your databases and its adapter (`"DB": { "adapter": "d1" }`). Run `npx active-record init` to write it: it reads your Wrangler config, and links a JSON Schema your editor completes the file from. A D1 database's other settings stay in your Wrangler config. `--adapter` is gone from every command but `init`, and `--config` now names `active-record.jsonc`.

Run `npx active-record schema` once: the generated schema now imports `d1` from `@forestfuture/active-record/d1`, and until you regenerate it, `schema --check` reports it as out of date. See [Upgrading](https://active-record.forestfuture.dev/upgrading).
