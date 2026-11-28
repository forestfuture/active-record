---
"@forestfuture/arbor": patch
---

With several databases, `npx arbor migrate` now migrates each one in turn, in the order `arbor.jsonc` names them, and stops at the first that fails; `--database` migrates only the one it names. With `--remote`, it asks for each database's name before it migrates any. The generators and the console use the first database `arbor.jsonc` names unless `--database` names another, rather than refusing, and the generators' next step is plain `npx arbor migrate`.

An entry's `"migrate": false` leaves that database to another app's migrations: `migrate` skips it and refuses `--database` naming it, while `schema`, the generators and the console still use it.
