# Coding standards

Judgement calls the `code-review` skill's Standards axis checks, beyond what `vp check` enforces and what `CONTRIBUTING.md` and `docs/agents/docs-voice.md` state. Anything a tool can check belongs in a check, not here.

## Tests

- **A test's name reads as a sentence after its `describe`**, and says only what that example shows. Read "describe › test" aloud. Under `describe("none() with no database")`, write "finders and counts answer", not "answers without one": the `describe` already says it. A name stands alone, so no "so do…", "too", "also", "as well", or opening "and" or "…", leaning on a sibling. Lint flags one (`d1-record/standalone-test-name`). When the word belongs to what the test shows, opt out on the line before it with the reason: `// oxlint-disable-next-line d1-record/standalone-test-name -- <why>`.
- **Assert results**, such as the records that come back. Assert SQL text only for safety properties, and query counts through `onQuery`.
- **One behavior per test.** A second `await` of a different Model in the same test, or a `DELETE` between assertions, means two tests.
- **A test that passes on first run is a guard.** Say so in the commit body.
- **Wait on an event, a gate, or a polled state, never a fixed delay.** A timer passes until a slow run outlasts it. Lint flags one (`d1-record/no-fixed-delay`). When the delay is what's tested, such as typing speed or a write that must not happen, or it only paces or bounds another wait, such as a poll's interval or a race's timeout, opt out on the line before it with the reason: `// oxlint-disable-next-line d1-record/no-fixed-delay -- <why>`.
- **Type tests see `@internal` members.** Tests compile against `src`, and only the built `.d.ts` hides them. Don't ask for a source-level `@ts-expect-error` test of one; `vp run check:public-types` covers it.

## Names and comments

- A module's first line says what it owns (lint enforces it); update it when the module gains a responsibility.
- Extract a dense pipeline into a named helper instead of casting through it.
