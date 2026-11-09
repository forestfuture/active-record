# AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `forestfuture/active-record`. Before any `gh issue` command, read `docs/agents/issue-tracker.md`: plain `gh issue view` prints nothing here.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Working on an issue

Follow `docs/agents/workflow.md` for every issue. In short: orient (the issue and its comments, `GLOSSARY.md`, the contract, ADRs) → **agree the test seams and open decisions with the human before writing tests** → build red → green, one committed slice at a time → `code-review` skill, acting on the findings that survive verification → push and open the pull request yourself → **merge only with the human's approval**, then close the issue with a summary. Workflow skills (`tdd`, `code-review`, `grilling`, `domain-modeling`, `implement`, `implement-spec`, `to-spec`, `pr`, `retro`, `codebase-design`) are in `.claude/skills/`. Agents other than Claude Code can read each `SKILL.md` as plain instructions. To update or add skills, see `.claude/skills/README.md`.

## Project

- Naming and attribution: ForestFuture, never a person, in every file; see `CONTRIBUTING.md#naming-and-attribution`.
- Read `GLOSSARY.md` (glossary), `docs/contract.md` (agreed behavior) and `docs/adr/` before changing the public API.
- Packages: `packages/active-record` is the core (`@forestfuture/active-record`), with the `active-record` command in `cli/`, `packages/d1-record` the D1 adapter and its plugin for the command (`@forestfuture/d1-record`), and `packages/pg-record` the Postgres adapter (`@forestfuture/pg-record`, private until it moves into the core package). Each adapter imports the core only through its entries (`@forestfuture/active-record`, `/adapter`, `/cli`), and the core never imports an adapter; lint enforces both (ADR-0016). `vp run build` builds the core, then the adapters.
- Module map: every file in `packages/*/src/` and `packages/*/cli/` opens with a line saying what it owns. List them with `grep -m1 -H '^//' packages/*/src/*.ts packages/*/cli/*.ts packages/*/cli/*/*.ts` before searching the code (lint enforces the line).
- Dependency APIs (D1 types, Wrangler, Miniflare, Vite+, Oxlint, Blume, tsdown): `docs/agents/dependencies.md` says where each lives.
- Library code in `packages/*/src/` must run on Cloudflare Workers. It's type-checked against `@cloudflare/workers-types` only (each package's `src/tsconfig.json`), with no Node APIs. The one exception is `withDatabase`'s `AsyncLocalStorage`, loaded with `process.getBuiltinModule("node:async_hooks")` when it's first called, and guarded, so Workers without Node.js compatibility still build and run (ADR-0012). `cloudflare:workers` is loaded the same way, only when a query needs a Model's binding.
- Tests: `tests/unit/**` (no database), `tests/conformance/**` (the portable conformance suite, run per adapter through `tests/support/harness.ts`; `conformance:d1` runs it on Miniflare D1), `tests/integration/**` (the D1 adapter's own tests and its command's, real D1 through Miniflare in Node; see ADR-0002 and `tests/support/d1.ts`), `tests/integration/pg/**` (`integration:pg`, pg-record's own tests), and `tests/remote/**` (smoke suites against a real remote D1 and a real Hyperdrive, skipped unless configured; see `docs/agents/remote-smoke.md`). `conformance:pg` and `integration:pg` run against the Postgres server `DATABASE_URL` names, and are left out without it; CI requires them. Run one project with `vp test --project unit`.
- Behavior is the contract: every public behavior needs a test against a real database. Portable behavior goes in `tests/conformance/`, which can't name D1; what only D1 does goes in `tests/integration/`.
- A public change updates every file in `CONTRIBUTING.md#what-a-public-change-touches`, a changeset included (`docs/agents/releasing.md`). Merging CI's Version Packages pull request is what publishes to npm.
- `vp check` enforces size and complexity limits (Oxlint `complexity`, `max-depth`, `max-params`, `max-lines-per-function`, and `max-lines` per module in `vite.config.ts`: 10 complexity, 3 deep, 4 params, 60 lines per function, 500 per module). Plan small functions; split code that hits a limit rather than raising it. `vp run knip` reports unused files, exports and dependencies.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
