---
"@forestfuture/active-record": minor
"@forestfuture/d1-record": patch
---

The `active-record` command now speaks for any adapter. Its help and messages say the database, its binding and its config, and D1's own words (`migrations_pattern`, the config file) come from D1's plugin. `active-record schema --check` now reports a schema as out of date when it was written for another adapter, so a schema written before this release reads as out of date once: run `npx active-record schema` to bring it up to date. The console keeps its history in `.wrangler/active-record-history`; the old `.wrangler/d1-record-history` isn't read, so earlier history isn't offered. The command itself needs Node 22.5 or later; on D1 every command still needs 22.13 (23.4 on Node 23), for `node:sqlite`, and says so before it starts. A plugin for the command (`@forestfuture/active-record/cli`, unstable) reads a schema asynchronously, names the folder for the command's local files, can say why a Node can't run it, and gets the chosen database's migrations folder in place of D1's account; a plugin whose name isn't its adapter's is refused.
