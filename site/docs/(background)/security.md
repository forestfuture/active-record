---
title: Security
description: "What d1-record protects against and what's left to your app, the guarantees its tests check, how its supply chain is set up, and a log of the security reviews it has had."
---

Whatever a request sends can reach a query or a record through d1-record, so a mistake in it is a mistake in every app that uses it. Here’s what it protects against, what it leaves to your app, the tests that check each guarantee, how releases are built, and the security reviews it has had.

These are the project’s own reviews, not an independent audit. Each says what it covered and what it didn’t.

## What d1-record protects against

- **SQL injection.** Every value is bound as a parameter, never written into SQL text. Identifiers come only from a Model’s declared attributes, and are quoted. Raw SQL is only possible through the `sql` tagged template, which binds every value it’s given.
- **Values that aren’t what TypeScript says.** A value from JSON, a form, or a query string is cast to its attribute’s type when it’s assigned or used in a condition, and anything ambiguous is refused: `"false"` can’t save `true`. See [Models](./models#casting-assigned-values).
- **Prototype pollution and inherited names.** Attributes and associations are looked up only by the Model’s own names, so `__proto__`, `constructor`, and other names every object has are unknown names, and `Object.prototype` is never written to.
- **Secrets in logs and errors.** Values of attributes named like passwords, tokens, keys, and emails are hidden from `onQuery` listeners and from error messages. See [Logging](./logging#keeping-secrets-out-of-the-logs).
- **One request’s data reaching another.** Nothing about a request (a D1 Session, a listener) is ever stored on a Model class. See [Database resolution](./query-databases).
- **Denial of service through parsing.** The patterns that read numbers and dates are linear, so a long value can’t use up a Worker’s CPU time.

## What’s left to your app

- **Choosing which fields a request may set,** with `permit`, destructuring, or a schema. See [Untrusted input](./untrusted-input).
- **An untrusted `null` in a condition.** `findBy({ token: null })` matches rows whose token is NULL. Check a value’s type before querying with it.
- **Authorization.** Whether this user may read or change this record is your app’s decision.
- **Formats and ranges.** Casting checks types, not meaning: use [validations](./validations).
- **Bare values inside `sql` fragments.** A value with no attribute isn’t hidden from listeners. Write it as `column("token").value(token)`, and it’s filtered like the attribute’s other values.
- **Which associations a request may include.** A name from `?include=` only matches a Model’s own associations, but each level of a chain adds a subquery. Allow only the include paths you mean.

## Guarantees, and the tests that check them

The library’s guarantees are tested against a real D1 database (through Miniflare), and CI’s by a test that reads its workflows. CI runs every test on every change.

| Guarantee                                                                                                         | Tests                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Values are bound, identifiers are quoted, and plain strings are refused as SQL                                    | [`sql-safety`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/sql-safety.test.ts)                      |
| Assigned and condition values are cast, or refused, in linear time                                                | [`attribute-casting`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/attribute-casting.test.ts)        |
| Naming an attribute, table or key takes linear time in the name’s length                                          | [`naming`](https://github.com/forestfuture/d1-record/blob/main/tests/unit/naming.test.ts)                                     |
| Only a Model’s own names are attributes or associations                                                           | [`name-lookups`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/name-lookups.test.ts)                  |
| `permit` keeps only the named attributes, reading own keys only                                                   | [`permit`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/permit.test.ts)                              |
| Filtered attributes’ values never reach listeners or errors                                                       | [`filter-attributes`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/filter-attributes.test.ts)        |
| A request’s database stays with that request                                                                      | [`current-database`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/current-database.test.ts)          |
| Names, assigned values, conditions, bound text, permitted keys, and JSON hold for any input, not only chosen ones | [`properties`](https://github.com/forestfuture/d1-record/tree/main/tests) (`*-properties.test.ts`, generated with fast-check) |
| The tests cover at least 90% of the library’s and command line’s branches, and CI fails below that                | [`coverage`](https://github.com/forestfuture/d1-record/blob/main/vite.config.ts)                                              |
| CI’s actions are pinned, and release jobs run no install scripts                                                  | [`ci-workflows`](https://github.com/forestfuture/d1-record/blob/main/tests/unit/ci-workflows.test.ts)                         |

## Supply chain

- **No runtime dependencies in your Worker.** The library imports no package but its own two, `@forestfuture/active-record` and the `@forestfuture/d1-record` adapter, so no other package’s compromise can reach your Worker through it. The command line, a development tool, depends on `jiti` to load your Models; installing `@forestfuture/d1-record` installs it, and your Worker doesn’t bundle it.
- **The command line runs your Model files.** `d1-record schema`, the generators, and the console load them to find your Models, so code at a Model file’s top level runs each time, `d1-record schema --check` in CI included.
- **Releases are built by CI.** The npm package is built and published by the repository’s release workflow, never from a laptop, so what’s on npm is what’s in the repository. Publishing uses npm’s trusted publishing, so no npm token is stored anywhere, and each version carries a provenance attestation linking it to its commit. Version 0.1.0 was published before that was set up, with a one-time token, and has no attestation ([#109](https://github.com/forestfuture/d1-record/issues/109)); 0.1.1 and later do.
- **CI is pinned.** Every third-party GitHub Action is pinned to a commit, not a tag that could be moved, because a moved tag would run someone else’s code in the job that publishes. A test fails if one isn’t.
- **Release jobs run no install scripts.** The jobs that decide, build, version, and publish a release install dependencies without running their install scripts and without a shared cache, so a compromised development dependency can’t change what’s built or published.
- **Dependencies are watched.** Dependabot proposes updates weekly, waiting a week after each release, since a compromised release is usually caught within days. `pnpm audit` is part of each security review.

## Review log

Each security review adds an entry here: what it covered, how, what it found, and what it didn’t cover.

### 2026-10-04: the library, its command line, and CI

**Scope:** the library (`src/`), the command line (`cli/`), the CI and release workflows, and the development dependencies.

**Method:**

- a security review of the whole codebase with Sentry’s `security-review` skill (OWASP-based), briefed on a library’s risks: what happens when an app passes untrusted input into it;
- untrusted inputs probed against a real D1 database: prototype keys, wrong types, `null`, long values;
- a dependency audit with Trail of Bits’ `supply-chain-risk-auditor` and `pnpm audit`;
- each fix then reviewed with Trail of Bits’ `differential-review`.

**Findings, all fixed:**

| Severity | Finding                                                                                   | Issue                                                      |
| -------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| High     | Assigned values weren’t checked at runtime: `"false"` saved as `true` for a boolean       | [#81](https://github.com/forestfuture/d1-record/issues/81) |
| High     | The publish job used actions pinned by movable tags, and ran install scripts              | [#80](https://github.com/forestfuture/d1-record/issues/80) |
| High     | Found while fixing #81: a pattern that backtracked on long numbers (ReDoS)                | [#81](https://github.com/forestfuture/d1-record/issues/81) |
| Medium   | No protection against mass assignment, and no guidance on an untrusted `null`             | [#82](https://github.com/forestfuture/d1-record/issues/82) |
| Medium   | Bound values, secrets included, reached `onQuery` listeners and errors                    | [#83](https://github.com/forestfuture/d1-record/issues/83) |
| Low      | Inherited names (`constructor`, `__proto__`) caused errors instead of being unknown names | [#84](https://github.com/forestfuture/d1-record/issues/84) |
| Low      | Development dependency advisories, and unescaped config values in generated code          | [#85](https://github.com/forestfuture/d1-record/issues/85) |

**Not covered:** the source of the third-party Actions at their pinned commits; D1 and workerd themselves; isolation between concurrent requests beyond the existing tests; apps’ own code.

### 2026-10-10: CodeQL’s alerts on the public repository

**Scope:** the library (`src/`), the command line (`cli/`) and the tests, as CodeQL’s default setup (JavaScript/TypeScript and Actions) scans them on every push and weekly.

**Method:** each alert from the first scans of `main`, read against the code, then either fixed with a test or dismissed with a written reason on the alert. Property-based tests (#122) then generated inputs for the places untrusted input reaches the library.

**Findings:**

| Severity | Finding                                                                                                                                                               | Outcome                                                                                                           | Link                                                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| High     | Naming an attribute, table or key took quadratic time in the name’s length (ReDoS)                                                                                    | Fixed test-first, and checked against the old rule on every short string                                          | [#116](https://github.com/forestfuture/d1-record/issues/116), [alert 1](https://github.com/forestfuture/d1-record/security/code-scanning/1)                  |
| High     | A test helper strips HTML tags from the guide’s own pages with a regular expression                                                                                   | Dismissed: test-only code, and its output is never rendered                                                       | [alert 2](https://github.com/forestfuture/d1-record/security/code-scanning/2)                                                                                |
| Medium   | The command line writes a column’s default into generated source (two alerts)                                                                                         | Dismissed as false positives: every value goes through `JSON.stringify` or an identifier check, then is only data | [alert 3](https://github.com/forestfuture/d1-record/security/code-scanning/3), [alert 4](https://github.com/forestfuture/d1-record/security/code-scanning/4) |
| Low      | Found while triaging alert 4: a `__proto__` key in a JSON column default is lost from the generated schema                                                            | Fixed, with a generated property as its test                                                                      | [#119](https://github.com/forestfuture/d1-record/issues/119)                                                                                                 |
| Low      | Found by the generated tests: refusing a value with no JSON form and no string form threw `Cannot convert object to primitive value` first (only code can assign one) | Fixed, with the property that found it                                                                            | [#122](https://github.com/forestfuture/d1-record/issues/122)                                                                                                 |

**Not covered:** the Scorecard findings, which are about the project’s practices, not its code, and the dependencies’ own code.

### 2026-10-25: before 0.5.0

**Scope:** the changes to the library (`src/`), the command line (`cli/`), and CI since the 2026-10-04 review: Models extending `ApplicationRecord` (#232), `withSession` (#220), preloading in one batch (#217), stored dates (#73, #159, #216), error messages (#88), `column().value()` (#142), and the console (#104).

**Method:**

- a security review of those changes with Sentry’s `security-review` skill (OWASP-based), tracing each untrusted input (a request’s cookie or header, `?include=` names, assigned values, stored cells) to where the library uses it;
- Trail of Bits’ `differential-review` of #232’s change before it merged.

**Findings:**

| Severity | Finding                                                                                  | Outcome                                                                 | Link                                                         |
| -------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Low      | `d1-record schema` wrote a class’s name into generated source unchecked                  | Fixed before merging: a name that isn’t an identifier is refused        | [#234](https://github.com/forestfuture/d1-record/pull/234)   |
| Low      | `d1-record schema --check` wrote a placeholder schema when there was none                | Fixed before merging: `--check` writes nothing                          | [#234](https://github.com/forestfuture/d1-record/pull/234)   |
| Low      | A chain of includes named in a request nests a subquery per level                        | Documented: allow only the include paths you mean                       | [#235](https://github.com/forestfuture/d1-record/issues/235) |
| Low      | A bookmark D1 can’t use, in a forged or planted cookie, failed every request carrying it | Fixed: the Session starts again from `start`, checked against a real D1 | [#237](https://github.com/forestfuture/d1-record/issues/237) |

**Not covered:** D1 and workerd themselves; the dependencies’ code; apps’ own code.

## Reporting a vulnerability

Please report a security problem privately, as the [security policy](https://github.com/forestfuture/.github/blob/main/SECURITY.md) describes, never in a public issue.
