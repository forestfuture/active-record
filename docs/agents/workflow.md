# Working on an issue

The process every issue in this repo follows, whoever or whatever picks it up. It has two **human checkpoints**: agreeing the seams before any test (step 2), and merging the pull request (step 5). At both, the agent stops and waits, and never assumes approval. Between them the agent works on its own: it acts on the review findings that survive verification, and opens the pull request itself.

The skills named below are in `.claude/skills/`. Claude Code loads them automatically. Other agents should read the named `SKILL.md` and follow it.

## 1. Orient

- Read the issue **and its comments**. Scope often moves between issues in comments ("moved here from #1").
- Read `GLOSSARY.md` (use its terms), the `docs/contract.md` sections the issue names, and the ADRs in `docs/adr/` that touch the area.
- Check the current state: `vp install`, `vp check`, `vp test` should all pass before you change anything.

## 2. Agree the seams and open decisions — ✋ human checkpoint

Before writing any test, propose to the human, in one message:

- **The seams under test** (see the `tdd` skill). The default for this repo is the **public API against a real Miniflare D1**. Observe queries only through the public `onQuery` hook. There's no fake executor (ADR-0002). Type tests go in `tests/unit/`. Portable behavior goes in `tests/conformance/`: copy the setup in `tests/conformance/to-sql.test.ts`, `openHarness()` from `tests/support/harness.ts`, seeding with `harness.exec` (`?` placeholders, SQL every adapter accepts) and `harness.reset`, an `onQuery` events array, and `order({ email: "asc" })` / `where({ ... })` taking objects (plain strings throw). What only D1 does (Sessions, bookmarks, round trips, its CLI, SQLite's own SQL) goes in `tests/integration/d1/` (`integration:d1`), with `createTestDatabase` from `tests/support/d1.ts`. What only Postgres does (its clients, Hyperdrive, workerd) goes in `tests/integration/pg/`, with `openPgSchema` from `tests/support/pg.ts`; set `DATABASE_URL` to run it and `conformance:pg`. A behavior an adapter does its own way is an allowed difference, listed in `tests/conformance/allowed-differences.ts` with the tests it skips there, or those that avoid it.
- **The build order**: the list of red → green slices you'll work through.
- **The docs outline**, for each guide page or section the change touches: its four answers (Diátaxis type, audience, goal, scope) and an outline, so the human approves them with the seams. The `documentation-writer` skill runs in step 3, when the copy is written.
- **Names**: each new public name, option, field, or module, with the phrase it reads in, and any alternative you weighed. A name is cheapest to change here, before tests and docs use it. See the naming rule in `CONTRIBUTING.md`.
- **Open decisions**: anything the issue or contract leaves unsettled. Number each one, give a recommendation, and say why (the `grilling` skill's format). If a term is fuzzy or new, sharpen it with the `domain-modeling` skill: update `GLOSSARY.md`, and offer an ADR only for decisions that are hard to reverse, surprising, and a real trade-off.

**Wait for the human's answers.** Postponed ideas become `deferred` issues, one per item, not notes in a comment.

## 3. Build test-first

Follow the `tdd` skill, one vertical slice at a time:

1. Write **one** failing test. Run it and confirm it fails for the expected reason (red). A red test that opens a console, a server or a process waits out its timeout, so run it with `--bail 1 --test-timeout 20000` and raise the timeout only once it is green.
2. Write the least code that makes it pass (green).
3. Run `vp check --fix` (format, lint, types, complexity limits) and `vp test`. Without `--fix`, a formatting error hides the lint errors, and the pre-commit hook then rejects the commit. `packages/active-record/src/relation.ts` sits at the 500-line cap, so adding to it means moving code to another module in the same commit. When a slice passes, **commit it** on the issue's branch, named `<issue>-<slug>` (`main` takes pull requests only), with a message saying what behavior was added (see [Commit messages](#commit-messages)).

### Commit messages

- **Title**: aim for 50 characters (the `commit-msg` hook warns past 60 and rejects past 72; a few over is fine). Imperative, capitalized, no trailing period, no `feat:`-style prefixes. End with the issue number: `(#82)`.
- **Body**, after a blank line: what behavior changed and why, in a few short lines or bullets wrapped at 72. The detail goes here, not in the title.

```text
Tidy permit's docs, types and tests (#82)

- validates gets its doc comment back
- permit's comment mentions forms and query strings
- One Permitted type replaces the variants
- Tests: a misspelled name is a compile error, and
  a modelFor base class has permit
```

Rules that matter here:

- Assert **results**, such as the records that come back. Assert SQL text only for safety properties (bound values, quoted identifiers). Assert query counts through `onQuery`.
- A test that passes on first run is a **guard**, not a red. Say so. A commit that adds tests and stages nothing outside `tests/` holds only guards, and the `commit-msg` hook warns when its message doesn't say "guard".
- Behavior that depends on a **terminal** (typing, a paste, Ctrl-C or Ctrl-D, colors, a prompt) is checked in a `tests/integration/d1/*-pty.test.ts` through `tests/support/pty.ts`, which plays steps at a real pseudo-terminal. Piped streams can't show it: a paste reaches a process a line at a time, and typing triggers completion. Write one-off terminal scripts there instead of in a scratch folder.
- If a size or complexity limit trips, split the code. Don't raise the limit.
- When a change falsifies a claim ("local only", "never", "only", "alone"), grep the guide, README, help text, ADRs, glossary and changeset for that **stale claim** before the docs commit.
- Update everything a public change touches, as listed in [CONTRIBUTING.md](../../CONTRIBUTING.md#what-a-public-change-touches): the contract, glossary, guide page, exports, `packages/active-record/skills/active-record/SKILL.md`, README, changeset, and any ADR. If you implement something differently from the contract, update it and tell the human. While on 0.x, a changeset for a breaking change is `minor` and anything else is `patch` (`vp exec changeset`, see `docs/agents/releasing.md`).
- Guide copy (`site/docs/`, a Blume site: each page sits in its sidebar group's `(group)` folder, and a page with callouts or components is `.mdx`, where a `{` in prose is written `\{`), new or changed: run the `documentation-writer` skill before writing any of it, working to the outline agreed in step 2 (that approval stands; the skill needn't ask again). Write its sentences in the guide's voice ([docs-voice.md](docs-voice.md)). Its larger examples live in `site/snippets/`, where `vp check` type-checks them against the library, and a page embeds each with `<include>/_excerpts/<snippet>/<region>.ts</include>`, shown with the imports its code uses (`site/excerpts.ts` writes them before every build; an inline example must import what it uses from the package); they also run against D1 in `tests/integration/d1/site-examples.test.ts`, on their own schemas (`site/snippets/**/*.sql`).
- Scope changes (pulling work in from another issue, or pushing it out) get a comment on both issues.

## 4. Review

Run the `code-review` skill, with `main` (the branch's merge-base) as the fixed point and the issue as the spec. The standards sources are `CONTRIBUTING.md`, `CODING_STANDARDS.md` and [docs-voice.md](docs-voice.md). Commits from before the pull-request flow sit inside older ranges, so for those, give both reviewers the issue's own commits (`git log --grep='(#N)'`) and tell them to ignore the rest.

**Security.** When the change touches SQL compilation, attribute assignment or conversion, code generation or file writing in the CLI, or CI and release, also run the `differential-review` skill over the same range, as a third report. Write its report file outside the repo. The whole library gets a `security-review` before each release that changes those areas; each one adds a dated entry to the guide's Security page.

### Verify each finding

Hand every finding from every report to one fresh-context sub-agent, with the diff command, the issue, and the standards sources. Its job is to refute each finding: read the code at the cited file and line, and return **real**, **not real** or **unsure**, with the evidence. Then tag each finding:

- **Important**: a real defect, spec gap or standards breach in code this branch changed. Fix it.
- **Nit**: real, small and cheap. Fix it.
- **Pre-existing**: real, in code this branch didn't change. Open a `deferred` issue and leave the code alone.
- **Rejected**: refuted, or already enforced by tooling. Drop it, with a one-line reason.

Fix each finding as its own red → green slice (or as a refactor, with tests staying green), one commit per fix, so the pull request shows each fix by itself.

### Escalate decisions

Stop and ask the human, with a recommendation in the `grilling` skill's format, only for a finding that:

- changes a public name, `docs/contract.md` or an ADR;
- moves scope to or from another issue;
- is a high- or critical-severity security finding;
- the verifier marks **unsure**, or whose fix has more than one reasonable answer.

Act on every other finding without asking, and keep working while an escalated one waits.

### Converge

After the fixes, review once more, over the fix commits only (`git diff <last-commit-before-fixes>..HEAD`), and verify any new findings the same way. Start this round once every first-round fix has landed, an escalated finding's fix included, so no fix merges unreviewed. Two rounds is the cap: a finding still open after the second round goes to the human, as a sign the approach needs rethinking. A finding already handled isn't raised again.

Keep a **findings log** as you go: each finding, its tag, and its outcome (the fixing commit, the rejection reason, or the deferred issue). It becomes the pull request's Review section.

### Turn repeats into checks

A **mechanical** finding (a fixed pattern, a banned API, an import shape, a file location) is a **check candidate**: a lint rule or test could catch it every time, as the `retro` skill classifies them. List check candidates in the Review section. When one already appears in an earlier merged pull request (`gh pr list --state merged --search "<keyword> in:body"`), it has repeated, so open a `ready-for-agent` issue to build the check. A repeated judgement call becomes a line in `CODING_STANDARDS.md` instead.

## 5. Finish — ✋ human checkpoint

- Full validation: `vp run validate` runs these in CI's order and prints one line per step (the failing step's output after it): `vp check`, `vp run coverage` (`vp test` with a branch-coverage floor, set in `vite.config.ts`), `vp run build` (every package, the core first, with attw and publint), `vp run check:public-types` (after the build: the published types expose no internals; mark internals `/** @internal */`), `vp run knip`, `vp run docs:build` (`blume build`, then `blume validate --strict`: no dead links or broken anchors), `vp run check:package`. After a merge to `main`, CI deploys the site once the checks pass (the Cloudflare tokens it uses are in [cloudflare-tokens.md](cloudflare-tokens.md)).
- Once validation passes and no escalated finding is waiting, push the branch and open the pull request yourself. Push with an explicit refspec, `git push -u origin <branch>:<branch>`, so a branch that tracks `origin/main` can't push to `main`. If a push fails with `agent refused operation`, the human's SSH key is locked: ask them to run `git push`.
- The pull request says `Closes #<issue>`, and its body is written by the `pr` skill, with a Review section after Evidence, built from the findings log:

  ```markdown
  ## Review

  <N> findings: <n> fixed, <n> rejected, <n> deferred. (Or: "No findings.")

  | Finding                         | Tag             | Outcome             |
  | ------------------------------- | --------------- | ------------------- |
  | `<file>:<line>` <what is wrong> | Important / Nit | Fixed in <sha>      |
  | `<file>:<line>` <what is wrong> | Rejected        | <why it isn't real> |
  | `<file>:<line>` <what is wrong> | Pre-existing    | #<deferred issue>   |

  **Check candidates:** <mechanical findings a lint rule or test could catch, or "none">
  ```

- **Merging is the human's.** Wait for their go-ahead; `main` takes a pull request only, merged by rebase once `check` passes.
- After the merge, wait for CI on `main` to pass (`gh run watch`), then close the issue with a summary comment (if `Closes` didn't): what was delivered, the decisions made (link any `deferred` issues), and what the review found and fixed.
- The human may then run `/retro` on the session. It suggests changes to the agent's environment (checks, standards, steering files), not to the code. The Review section's check candidates are its first leads.

## Shortcuts

The `implement` skill chains steps 3–4 (`tdd`, then `code-review`). This document adds the repo-specific parts around it: the checkpoints, the D1 seam, the contract, verifying the findings, and closing the issue.

For a parent issue with sub-issues, the human can run `/implement-spec` instead. It builds the sub-issues in parallel worktrees and merges them onto one integration branch. Agree the seams and open decisions for each sub-issue first (step 2). Review the integration branch as in step 4, open its pull request as in step 5, and leave the merge to the human.

To turn a discussion into an issue, the human can run `/to-spec`. It writes a spec from what the conversation has already settled, checks the test seams with the human, and opens it as a `ready-for-agent` issue.
