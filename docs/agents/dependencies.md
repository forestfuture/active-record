# Where dependency APIs live

Read a dependency's types and docs from these paths, rather than searching `node_modules`:

- **D1 and the Workers runtime**: `node_modules/@cloudflare/workers-types/index.d.ts` (`D1Database`, `D1DatabaseSession`, and the `cloudflare:workers` module).
- **Wrangler's API** (`getPlatformProxy`, remote bindings): `node_modules/wrangler/wrangler-dist/cli.d.ts`. What it does that the types don't say, such as how D1 migrations are numbered and tracked, is in `cli.js` beside it.
- **Miniflare**: `node_modules/miniflare/dist/src/index.d.ts`. Tests reach it only through `tests/support/d1.ts`.
- **Vite+** commands and config: `node_modules/vite-plus/docs/guide/<command>.md`. `lint.md` covers the repo's own lint rules (`scripts/lint/`).
- **Oxlint rules** and their options: https://oxc.rs/docs/guide/usage/linter/rules.html. `vp lint --rules` prints nothing here.
- **Blume**, the documentation site: its docs are bundled at `site/node_modules/blume/docs/` (configuration in `configuration/index.mdx`, includes in `content/includes.mdx`, components in `content/components.mdx`), and its skills at `site/node_modules/blume/skills/`. `useblume.dev` has the same pages.
- **tsdown**, which `vp pack` runs in each package (`packages/*/vite.config.ts`): its config types are under `node_modules/.pnpm/@voidzero-dev+vite-plus-core@*/node_modules/@voidzero-dev/vite-plus-core/dist/tsdown/`.

## Waiting a week for new releases

`minimumReleaseAge` in `pnpm-workspace.yaml` (and in `.github/docs-deploy/pnpm-workspace.yaml`) holds every release back for a week, as Dependabot's `cooldown` does, so a compromised release is usually caught before it gets here. It applies to every install, not only Dependabot's: a hand bump or `pnpm update` takes the newest release that's at least a week old. A frozen install checks the lockfile too, and fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` on any entry younger than a week that isn't excluded.

A release that can't wait, such as a security fix, goes in `minimumReleaseAgeExclude` as one exact version (`"name@1.2.3"`). Never exclude a bare name: that lets every later release through as well. Add a comment naming the advisory, and remove the entry once that version is a week old. The Vite+ entries stay, since each Vite+ bump replaces them.

## Bumping Vite+

Dependabot is told to leave `vite-plus` and `@vitest/coverage-v8` alone, because each needs the others to move with it. Bump them together, in one change:

1. In `pnpm-workspace.yaml`, set `vite-plus` and `vite` (`npm:@voidzero-dev/vite-plus-core@…`) in the catalog to the same version, and the same version in each `minimumReleaseAgeExclude` entry.
2. Run `vp install`, then `vp toolchain` to read the vitest it bundles. The install also rewrites the Vite+ section of `AGENTS.md` when the new release changes it. Commit that change on its own.
3. Pin `@vitest/coverage-v8` in `package.json` to that vitest version, exactly. `vp test --coverage` refuses any other.
4. Run `vp run validate`.

## Bumping the docs deploy's Wrangler

CI's `docs-deploy` job runs its own Wrangler, pinned exactly in `.github/docs-deploy/package.json`, so the job holding the docs token never installs the workspace ([cloudflare-tokens.md](cloudflare-tokens.md)). Dependabot bumps it apart from the workspace's `wrangler`. To bump it by hand, change the version there and run `pnpm install --ignore-scripts` in that folder. A release under a week old fails there too ([Waiting a week for new releases](#waiting-a-week-for-new-releases)). The `check` job dry-runs both docs deploys with it, so a pull request that breaks that Wrangler fails `check` before it reaches `main`.

That folder also names pnpm's version in its `devEngines`, so a pnpm bump changes it there as well as in the root `package.json`.
