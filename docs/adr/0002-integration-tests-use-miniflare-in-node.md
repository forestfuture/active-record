# Integration tests run in Node against Miniflare's D1

Our toolchain is Vite+ 1.0, which bundles Vitest 5. `@cloudflare/vitest-pool-workers` (0.22.0 as of 2026-09) only supports Vitest `^4.1.0`, so our tests can't run inside workerd through `vp test`. Integration tests therefore run in Node, start Miniflare there and take its `getD1Database()`, which is a real workerd/SQLite D1 binding. Library code runs in Node during tests. That is acceptable because the library is pure JS and the D1 binding is the only Workers dependency, and `src/` is type-checked against `@cloudflare/workers-types` without Node types so Node-only APIs can't slip in.

## Considered Options

- Pin Vite+ 0.3.x (Vitest 4) to use pool-workers: rejected, because it means staying on a pre-1.0 toolchain.
- Run a separate `vitest@4` next to Vite+: rejected, because two Vitest versions in one repo is fragile.

## Consequences

A small smoke suite runs the library inside workerd without pool-workers (#10). `tests/workerd/` packs the built package, installs the tarball in a folder outside the repo, and bundles a fixture Worker that imports it by name with Wrangler's own build (`wrangler deploy --dry-run --outdir`), as an app's Worker is bundled. Miniflare runs the bundle with `nodejs_compat` and a real D1, and the suite checks the Workers-only seams: a Model's binding read from `cloudflare:workers`, `withDatabase`'s `AsyncLocalStorage`, a preload, and class names kept through the bundle. It needs the build, so it's its own Vitest project, `workerd`, run with `vp run test:workerd` after `vp run build`, in `vp run validate` and CI's `static` job. Plain `vp test` leaves it out.

The main integration suite stays in Node. Moving the workerd suite to pool-workers is optional, once pool-workers supports the toolchain's Vitest: it would make the tests nicer to write, not check more.
