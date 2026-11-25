# Integration tests run in Node against Miniflare's D1

Our toolchain is Vite+ 1.0, which bundles Vitest 5. `@cloudflare/vitest-pool-workers` (0.22.0 as of 2026-09) only supports Vitest `^4.1.0`, so our tests can't run inside workerd through `vp test`. Integration tests therefore run in Node, start Miniflare there and take its `getD1Database()`, which is a real workerd/SQLite D1 binding. Library code runs in Node during tests. That is acceptable because the library is pure JS and the D1 binding is the only Workers dependency, and `src/` is type-checked against `@cloudflare/workers-types` without Node types so Node-only APIs can't slip in.

## Considered Options

- Pin Vite+ 0.3.x (Vitest 4) to use pool-workers: rejected, because it means staying on a pre-1.0 toolchain.
- Run a separate `vitest@4` next to Vite+: rejected, because two Vitest versions in one repo is fragile.

## Consequences

Revisit once pool-workers supports Vitest 5. Then add a small workerd smoke suite; don't move the whole integration suite.
