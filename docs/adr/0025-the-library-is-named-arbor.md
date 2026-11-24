# The library is named Arbor

The library was named for its pattern: `@forestfuture/active-record`, with an `active-record` command (and `ffar` for short) and an `active-record.jsonc`. A pattern's name can't be searched for, and it reads as Rails' own library. So the library is now **Arbor**, and "Active Record" names only the pattern it follows (ADR-0016) and Rails' library (#558).

Everything that names the library follows, with no alias, since there were no users to move: the package is `@forestfuture/arbor` in `packages/arbor`, the command is `arbor`, with no short form, the config file is `arbor.jsonc`, the base error class is `ArborError`, the skill is `arbor`, the repository is `forestfuture/arbor`, and the guide is at arbor.forestfuture.dev, where both of its earlier hosts redirect. The version line continues: the first release under the new name is 0.11.0, and `@forestfuture/active-record` is deprecated on npm.

## Consequences

- **"Arbor ORM" where the name stands alone or introduces the library**: the README's title, the package's description, the site's title and meta description, and listings. The tagline is "Arbor: an Active Record ORM for TypeScript on Cloudflare D1 and PostgreSQL". Elsewhere it's "Arbor", and in a list of libraries "Drizzle, Kysely, Prisma, Arbor". `CONTRIBUTING.md` and `GLOSSARY.md` hold the rules.
- **No ™ or ® beside Arbor.** What's written beside the name stays about databases and TypeScript.
- **The docs install before `npx arbor`.** The unscoped npm package `arbor` is another project's, with an `arbor` bin, so `npx arbor` before an install would run that one. A one-liner that has to run first uses `npx @forestfuture/arbor`, which runs the same bin. If the unscoped name is ever this library's, its first version is 0.9.0 or later, so no version of it is confused with that project's.
- **History keeps the old names.** The changelog, the Upgrading page's earlier sections and earlier ADRs' decisions say what was true then; paths and names in ADRs that a reader follows today are updated.
