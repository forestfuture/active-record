---
"@forestfuture/active-record": patch
---

A D1 database's entry in `active-record.jsonc` can name its Wrangler config with `wranglerConfig`, relative to the file, for a Worker in another folder such as a monorepo's: `"DB": { "adapter": "d1", "wranglerConfig": "../worker/wrangler.jsonc" }`. The database's migrations and local state are read beside that config, and `migrate` and the console use the `wrangler` installed there before the project's own. The JSON Schema describes the setting. `schema` now finds Drizzle's and Prisma's files from each database's config folder, not only the first database's.
