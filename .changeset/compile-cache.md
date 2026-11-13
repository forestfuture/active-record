---
"@forestfuture/active-record": patch
---

The `active-record` command caches the TypeScript it compiles (#251), in the project's `node_modules/.cache/jiti`, so `schema`, `g` and the console load the library about ten times faster after their first run. An edited file is compiled again. A project without its own `node_modules` folder isn't cached.
