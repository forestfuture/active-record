# Adapters ship inside the core package, and active-record.jsonc names each database's adapter

The adapters are entries of `@forestfuture/active-record`, not packages of their own (#301): `@forestfuture/active-record/d1` and `@forestfuture/active-record/postgresql`. Each keeps its runtime in `src/adapters/<name>/` and its plugin for the command in `cli/adapters/<name>/`, and reaches the core only through the core's public entries, as ADR-0016's boundary required of a separate package. Lint keeps each adapter's imports in its own folder.

One package per adapter was for lock-in and for keeping drivers out of apps that don't use them. The import path still names the database, so a search for `@forestfuture/active-record/d1` finds lock-in as a search for `@forestfuture/d1-record` did. Drivers stay out as optional peer dependencies: `pg` and PGlite. A D1 app installs neither, and a Worker bundles only the entry it imports. Rails ships its adapters inside Active Record, with drivers left to the app, and Drizzle (`drizzle-orm/d1`) and Kysely do the same.

What separate packages cost goes away. There's one copy of the core by construction, so no peer dependency pinned to its version, no Changesets `fixed` group, and no placeholder publish to set up trusted publishing for each new adapter.

With the adapters inside the package, the command can't tell which one a project uses from `package.json`. A project's `active-record.jsonc` names each database's adapter instead (`"DB": { "adapter": "d1" }`), as Rails' `database.yml` does, and `active-record init` writes it. The command reads the file rather than guessing: a guess from Wrangler's `d1_databases` or from the generated schema would pick D1 during a move to Postgres, while both configs are in place. The file stays JSON with comments, so the command can edit it and read it without running the project's code, and it links a JSON Schema the package ships for editor completion.

## Consequences

- **Supersedes ADR-0016's packaging:** its "one package per adapter", "Adapters are pure adapters, with the core as a peer dependency", "One version" across packages, and "finds its adapter from `package.json`". The split of core and adapters, and the boundary between them, stand.
- **A breaking release.** `@forestfuture/d1-record` is deprecated on npm with no alias (pre-1.0); apps import `@forestfuture/active-record/d1`, run `active-record init`, and regenerate their schema.
- **The PostgreSQL adapter's names follow Rails:** the entry `/postgresql`, the factory `postgresql({ binding })`, and the adapter name `postgresql`.
- **`--adapter` is gone** from every command but `init`, and `--config` names `active-record.jsonc`.
- **One adapter per project, for now** (#305). Each entry names its adapter so that a project can later mix them.
- **`/adapter` and `/cli` stay, unstable,** for an adapter outside the package; the command only loads the plugins it ships with.
