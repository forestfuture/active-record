# Contributing to d1-record

Thanks for helping. The [ForestFuture contributing guide](https://github.com/forestfuture/.github/blob/main/CONTRIBUTING.md) applies here: start ideas and questions in a [Discussion](https://github.com/orgs/forestfuture/discussions), report a bug as an [issue](https://github.com/forestfuture/active-record/issues/new/choose) with the Bug report template, follow the [code of conduct](https://github.com/forestfuture/.github/blob/main/CODE_OF_CONDUCT.md), and report security problems privately, as the [security policy](https://github.com/forestfuture/.github/blob/main/SECURITY.md) describes. This page adds what’s specific to this repository.

## Setup

d1-record is built with [Vite+](https://viteplus.dev/guide/), whose `vp` command runs everything: install it (`curl -fsSL https://vite.plus | bash`, or see its guide for Windows), then:

```sh
vp install   # dependencies; pnpm is downloaded if you don't have it
vp check     # format, lint, type check
vp test      # every test
vp run coverage   # every test, and fails if branch coverage is under its floor (90%)
```

`vp test --project unit` runs the tests that need no database. `--project conformance:d1` runs what every adapter does, against a real D1 through Miniflare. `--project integration:d1` runs what only D1 does. Another suite runs against a remote D1; it's skipped unless configured, so you don't need it ([remote-smoke.md](docs/agents/remote-smoke.md)).

## Making a change

Every change goes through a pull request, maintainers' included:

1. **Start from an issue**, or a Discussion that reached a decision. Use the issue templates.
2. **Agree the design in the issue before writing tests**: the behavior to test and any open decisions. Read [`GLOSSARY.md`](GLOSSARY.md) (the glossary), [`docs/contract.md`](docs/contract.md) (the agreed behavior) and the ADRs in [`docs/adr/`](docs/adr/) first.
3. **Build it test-first**, one red → green slice per commit, on a branch named `<issue>-<slug>` (`79-contributing`).
4. **Open the pull request** with `Closes #<issue>`. CI runs `vp check`, the tests with a branch-coverage floor (`vp run coverage`), the package build and its checks, `vp run knip` and the docs build, and must pass to merge. On a first contribution, CI waits for a maintainer to approve the run.

Pull requests are merged by rebasing, so each commit stays on `main`: make each one pass on its own, with a message saying what behavior it adds or changes: a title of 50 characters or less, and the detail in the body ([commit messages](docs/agents/workflow.md#commit-messages)). [`docs/agents/workflow.md`](docs/agents/workflow.md) has the process in full.

The rules that matter most:

- **The contract is the source of truth.** A change in behavior updates `docs/contract.md` in the same pull request, and everything else it touches ([below](#what-a-public-change-touches)).
- **Every public behavior has a test**, through the public API against a real database (there's no fake one): the conformance suite (`tests/conformance/`) for what every adapter does, and the D1 adapter's tests (`tests/integration/d1/`) for what only D1 does.
- **Input from outside gets a property, not only examples.** Where untrusted input reaches d1-record (names, assigned values, bound text, permitted keys, JSON), a `*-properties.test.ts` states what must hold for any input, and [fast-check](https://fast-check.dev/) generates them. A failure prints a counterexample and its `seed` and `path`: pass both to `fc.assert` to replay it, then keep the counterexample as an example test.
- **Library code runs on Cloudflare Workers.** Each package's `src/` uses no Node APIs, and is type-checked against `@cloudflare/workers-types` only.
- **Names say what a thing means, in a reader's words.** Say the sentence a name appears in out loud (`rule.onRetype === "drop"`, `generateId` conflicts with `default`); if it needs explaining, choose again. Name the fact, not the mechanism. Don't pick a word that suggests the opposite (`excludes` for a rule that holds both ways). A predicate starts with `is` or `has`. Lint flags one whose return type is written as `boolean` or `x is T` (`active-record/predicate-name`); an action that says whether it worked, or a public name kept as Rails has it, opts out on the line before it with the reason: `// oxlint-disable-next-line active-record/predicate-name -- <why>`. A policy value (`"drop" | "keep"`) beats a flag that reads as a double negative. Use the glossary's word for a concept (`override`, not `change`), and one word for one concept. If a reviewer has to ask what a name means, rename it.
- **Size limits mean splitting code.** `vp check` enforces complexity, function-length, and module-length limits; split code that hits them rather than raising them.
- **Examples are neutral.** Tests, comments, docs, commit messages and changesets use neutral names (`User`, `Post`, `Product`). Nothing in them comes from a project you tried d1-record in.
- **Rails is the precedent.** When a behavior is open, d1-record does what Rails' Active Record does, unless D1 or TypeScript gets in the way.

The pre-commit hook runs `vp check --fix` on the staged files. The commit-msg hook checks the title's length, and warns when a commit stages nothing outside `tests/`, adds more tests than it removes, and doesn't say "guard". Run `vp test` yourself before pushing.

## What a public change touches

A change to public behavior or the public API updates, in the same pull request, each of these it affects:

- **`docs/contract.md`**: the section for the behavior. Its _Guide_ and _Code_ line names the pages and modules to check.
- **`GLOSSARY.md`**: a new term, or a term whose meaning changed.
- **`site/docs/`**: the guide page for the behavior, and its examples in `site/snippets/` (see [Documentation](#documentation)).
- **An entry's index**: a new public name is exported from the index of its entry (the core's `src/index.ts`, or an adapter's `src/adapters/<name>/index.ts`); an internal one is marked `/** @internal */`, and `vp run check:public-types` keeps it out of the published types. What only adapters need goes in the core's `src/for-adapters.ts`.
- **`packages/active-record/skills/active-record/SKILL.md`**: the agent skill's rules, when the change alters how an app should write code with the library.
- **`README.md`**: its quick look and feature list, when they show the behavior.
- **`.changeset/`**: a changeset (see [Changesets](#changesets)).
- **`docs/adr/`**: an ADR, for a decision that's hard to reverse, surprising, and a real trade-off.

## Changesets

A change users will notice (new behavior, a fix, a breaking change, a deprecation) comes with a changeset: `vp exec changeset`, or a file in `.changeset/`. While d1-record is on 0.x, a breaking change is `minor` and anything else is `patch`. Tests, refactors and contributor docs need none. See [releasing.md](docs/agents/releasing.md).

## Documentation

The guide is in `site/docs/` (a [Blume](https://useblume.dev) site at [active-record.forestfuture.dev](https://active-record.forestfuture.dev), `vp run docs:dev`), and a change in behavior updates its page too. Each page sits in its sidebar group's folder (`(basics)/models.mdx` is `/models`), ordered by the group's `meta.ts`.

- **Pages are organized by [Diátaxis](https://diataxis.fr/)**: tutorial, how-to guides, reference and background. A new page, or a page's new structure, starts from the `documentation-writer` skill: decide its type, audience and goal, and agree the outline in the issue.
- **Write in the guide's voice** ([docs-voice.md](docs/agents/docs-voice.md)): open with what the reader does, assume a competent developer, keep examples short, and put side facts in notes.
- **Examples use d1-record's syntax**, even for features not built yet. Rails syntax appears only when comparing.
- **Where d1-record goes beyond Rails or differs from it**, a Rails box says so.
- **Larger examples live in `site/snippets/`**, where `vp check` type-checks them against the library and `tests/integration/d1/site-examples.test.ts` runs them against D1. A page embeds one with `<include>`, from the excerpts `site/excerpts.ts` writes. An example written inline in a page imports what it uses.

## Naming and attribution

- **ForestFuture** in prose, logos and titles.
- **forestfuture** in domains, handles, package scopes and repos (`forestfuture.dev`, `@forestfuture/active-record`, `github.com/forestfuture`).
- Never "Forest Future", "Forestfuture" or "Forest-Future".

Files in the codebase (licenses, `package.json`, docs, test data) are attributed to ForestFuture, never to a person: `Copyright (c) 2026 ForestFuture`, `"author": "ForestFuture (https://forestfuture.dev)"`. Vendored third-party files keep their own authors (`.claude/skills/LICENSE-*`). Commit with your GitHub noreply address, not a personal email.

## Working with coding agents

Coding agents are welcome. [`AGENTS.md`](AGENTS.md) is written for them, and the workflow's skills are in `.claude/skills/` (Claude Code loads them; other agents can read each `SKILL.md`). Whoever opens a pull request is responsible for it, however it was written.

## Releases

Maintainers release by merging CI's Version Packages pull request, which publishes to npm. Contributors never publish.
