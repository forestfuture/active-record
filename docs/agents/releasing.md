# Releasing

Versions and the changelog are managed with [Changesets](https://changesets.dev), and CI publishes to npm. Nothing is published by an ordinary commit to `main`: the **Version Packages** pull request is the gate.

## Day to day: add a changeset

Every user-visible change (new behavior, a fix, a breaking change, a deprecation) comes with a changeset, committed with the change:

```sh
vp exec changeset
```

Or write the file by hand in `.changeset/` (any name ending in `.md`):

```md
---
"@forestfuture/d1-record": patch
---

`findBy` accepts a comparison, as `where` does.
```

The line is for the library's users: say what changed for them, not how. Internal changes (tests, refactors, docs for contributors, CI) need no changeset.

**Which bump, while on 0.x:** a breaking change is `minor` (0.1.x → 0.2.0), and a feature or a fix is `patch`. `major` is for 1.0. npm's `^0.1.0` ranges never take a new minor, so users only get breaking changes when they choose to.

## What CI does

The release jobs in `.github/workflows/ci.yml` run on `main`, after `check` passes, one run at a time:

1. **`release-mode`** works out what to do:
   - `version` while changesets are waiting;
   - `publish` once a package's `package.json` has a version npm doesn't have yet;
   - `none` otherwise, which is what most pushes hit.
2. **`release-version`** opens or updates the **Version Packages** pull request. That pull request bumps both packages' `package.json` (Changesets' `fixed` mode keeps them at one version), writes each package's `CHANGELOG.md` (formatted with `vp fmt`) and deletes the used changesets. `packages/d1-record/CHANGELOG.md` holds the history from 0.1, when the core was part of it; `packages/active-record/CHANGELOG.md` starts at 0.6. CI rewrites its branch on every push to `main`, so don't edit it by hand. Pull requests opened by Actions don't run CI, but merging one runs CI on `main` before anything is published.
3. **`release-pack`** packs a tarball for each package (#277). Packing runs each package's `prepack` script: the core's builds its `dist/` with `vp pack` (attw and publint included), then the docs site, and copies its `llms-full.txt` into the package, so a docs build that fails, a dead link included, blocks the release. The D1 adapter's builds the core, then its own `dist/` against the core's declarations. Changesets' `fixed` mode keeps both at one version, and the adapter's peer dependency on the core is pinned to it.
4. **`release-publish`** publishes the tarballs to npm with provenance, tags the commit with the version, and creates a GitHub Release with its changelog. It's the only job that can get an OIDC token (`id-token: write`). Changesets publishes with pnpm, so provenance is turned on with `PNPM_CONFIG_PROVENANCE`: pnpm ignores `NPM_CONFIG_*`.

To release, merge the Version Packages pull request.

**Publish only with pnpm.** In the repo, each package's `exports` point at its source, and the D1 adapter's peer dependency on the core is `workspace:*`. pnpm swaps in `publishConfig.exports` and the core's version when it packs; npm doesn't, so `npm publish` would upload a package no app could import or install. Each package's `prepublishOnly` (`scripts/require-pnpm.mjs`) refuses any publisher but pnpm. A publish by hand, such as the core's first (#279), runs `pnpm publish`, or `pnpm pack` and then `npm publish <tarball>`; check the packed `package.json` first.

## One-time setup

These are done once, in this order.

1. **Allow Actions to open pull requests.** In the `forestfuture` organization's settings, then in the repository's: Settings → Actions → General → Workflow permissions → **Allow GitHub Actions to create and approve pull requests**. Both have to allow it.
2. **Make the repository public.** npm only attaches provenance to packages published from a public repository.
3. **Edit anything that says the package isn't published yet**, in a pull request to `main`: the "Not on npm yet" warning in `site/docs/(introduction)/getting-started.mdx`.
4. **The first release used a temporary token**, because npm only lets a trusted publisher be set on a package that already exists. `0.1.0` went out this way on 2026-10-10: a granular access token named `d1-record first release` (Read and write for the `@forestfuture` scope, the shortest expiry, "Bypass two-factor authentication" ticked), stored with `gh secret set NPM_TOKEN`, and written to `~/.npmrc` by a step in `release-publish` that has since been removed. If a publish fails because pnpm tried trusted publishing first (an OIDC or token-exchange error), nothing was published: delete the tag and release if they were created, then re-run the failed `release-publish` job.
5. **Then switch to trusted publishing:**
   1. On npmjs.com, the package's Settings → **Trusted Publisher** → GitHub Actions: organization `forestfuture`, repository `active-record`, workflow `ci.yml`, no environment.
      Allow **publish**, not only staged publish: with only `stage publish`, a publish fails with `403 Forbidden: OIDC permission denied for this action`. From a terminal outside the repo (npm refuses to run inside it, because of `devEngines`), `npm trust list @forestfuture/d1-record` shows the entry, and `npm trust github @forestfuture/d1-record --file ci.yml --repo forestfuture/active-record --allow-publish` creates one.
   2. Delete the secret (`gh secret delete NPM_TOKEN`) and the token on npmjs.com.
   3. In the package's Settings → Publishing access, choose **Require two-factor authentication and disallow tokens**.
   4. In the `forestfuture` organization's settings, require 2FA for members.
6. **Check each release for provenance.** The package page on npmjs.com shows a provenance badge linking to the commit, and the version has `dist.attestations`. `0.1.0` has none (#109), because a token published it. `0.1.1` was the first published through the trusted publisher, and has one (2026-10-10). The registry can take a few minutes to list a version just published: a 404 straight after a green `release-publish` is that lag, and `npm view @forestfuture/d1-record@<version> --prefer-online` settles it.

From then on, only CI in `forestfuture/active-record`, from `ci.yml`, can publish.

## The split's first release (0.6.0, #279)

The 0.6.0 release is the first of two packages, from a renamed repository. npm's provenance check needs each `package.json`'s `repository.url` to name the repository the release ran in, and trusted publishing can't be set on a package that doesn't exist yet. So, in this order:

1. **Rename the repository** (the maintainer): Settings → General → Repository name → `active-record`. GitHub redirects the old URLs, remotes and links. Locally, `git remote set-url origin https://github.com/forestfuture/active-record.git`.
2. **Update what names the repository**, in a pull request to `main`: each `package.json`'s `repository.url`, `.changeset/config.json`'s changelog `repo`, the README's badges, `context7.json`, `.github/ISSUE_TEMPLATE/`, `site/blume.config.ts`, `npx skills add forestfuture/active-record`, the issue link `active-record schema` writes into generated schemas (`packages/active-record/cli/schema/origin.ts`, and `tests/unit/cli-origin.test.ts`), and every `github.com/forestfuture/active-record` link in the guide, the README, `CONTRIBUTING.md`, and `docs/`. `git grep forestfuture/d1-record` finds them, beside the package's own name.
3. **Outside GitHub** (the maintainer):
   - On bestpractices.dev, change the project's repository URL to `https://github.com/forestfuture/active-record`.
   - OpenSSF Scorecard follows the repository by itself, from `scorecard.yml`; its badge URL changes with step 2.
   - On Context7, add `https://github.com/forestfuture/active-record` and claim it, as in "help agents find it" below; the old `/forestfuture/d1-record` entry goes stale. `context7.json` already names the new entry in `url`; replace its `public_key` with the one the claim modal shows.
4. **Point `d1-record`'s trusted publisher at the new name** (the maintainer). A package has one trusted publisher, so change the existing one rather than adding another: on npmjs.com, the package's Settings → Trusted Publisher → edit the repository to `active-record` (workflow `ci.yml`, publish allowed). From a terminal outside the repo, `npm trust list @forestfuture/d1-record` shows it before and after.
5. **Publish a placeholder of the core**, so its trusted publisher can be set (the maintainer), from a folder outside the repo holding only a `package.json` and a README:
   - `package.json`: `{ "name": "@forestfuture/active-record", "version": "0.0.0", "description": "Placeholder: install 0.6.0 or later.", "license": "MIT", "repository": { "type": "git", "url": "git+https://github.com/forestfuture/active-record.git" } }`
   - `npm login`, then `npm publish --access public`. This placeholder is plain files, not the workspace package, so `npm publish` is fine for it.
   - `npm deprecate @forestfuture/active-record@0.0.0 "Placeholder: install 0.6.0 or later"`.
6. **Set the core's trusted publisher** (the maintainer): `npm trust github @forestfuture/active-record --file ci.yml --repo forestfuture/active-record --allow-publish`, then its Settings → Publishing access → **Require two-factor authentication and disallow tokens**.
7. **Merge the Version Packages pull request.** CI publishes 0.6.0 of both packages, with provenance.
8. **Check the release:** `npm view @forestfuture/active-record@0.6.0 --prefer-online` and the same for `@forestfuture/d1-record`, each with `dist.attestations`; then install both into a fresh app, follow the guide's [Upgrading to 0.6](<../../site/docs/(how-to)/upgrading.mdx>), and run it.

## pg-record's first release (#270)

`@forestfuture/pg-record` is public from #270, so the Version Packages pull request after it publishes it for the first time. Its trusted publisher can't be set until it exists, so before merging that pull request (the maintainer):

1. **Publish a placeholder**, as for the core in step 5 above: `{ "name": "@forestfuture/pg-record", "version": "0.0.0", "description": "Placeholder: install 0.7.0 or later.", "license": "MIT", "repository": { "type": "git", "url": "git+https://github.com/forestfuture/active-record.git" } }`, then `npm deprecate @forestfuture/pg-record@0.0.0 "Placeholder: install 0.7.0 or later"`.
2. **Set its trusted publisher**: `npm trust github @forestfuture/pg-record --file ci.yml --repo forestfuture/active-record --allow-publish`, then Settings → Publishing access → **Require two-factor authentication and disallow tokens**.
3. **After the release**, check it as in step 8: `npm view @forestfuture/pg-record@0.7.0 --prefer-online`, with `dist.attestations`, then follow the guide's [Moving to Postgres](<../../site/docs/(how-to)/move-to-postgres.mdx>) on a fresh app.

## After the first release: help agents find it

1. **Install the skill once** to check it works for others: `npx skills add forestfuture/active-record`. skills.sh has no submission and no crawler: a skill is listed from the install counts that the skills CLI reports for public GitHub repositories. Look for `active-record` at https://www.skills.sh a day or two later.
2. **Topics (https://www.skills.sh/topic/databases) have no documented request process.** The Databases topic lists vendors' skills. If `active-record` isn't under a topic it fits, open a Feature request on `vercel-labs/skills` asking how topics are assigned. Don't send a "listing" request: the install already created the listing.
3. **Add the docs to Context7** (https://context7.com) at https://context7.com/add-library, on the GitHub tab, with `https://github.com/forestfuture/active-record`. Anyone can add a public library. Its Context7 ID is `/forestfuture/active-record` from the rename; the old `/forestfuture/d1-record` entry goes stale. Claim the new one: `context7.json` in the repository root holds the claim (`url` and `public_key`, from the claim modal on Context7, which must match exactly) and Context7's settings (title, description, the folders and files indexed, and rules for agents). Context7 refreshes by itself, and the claim's admin panel can refresh it.
   - **A known limit:** the guide pages include their larger examples from excerpts the site's build writes (`site/docs/_excerpts/`, not committed), so Context7's GitHub index shows those pages without the example code. The `llms-full.txt` the site builds has them expanded.
