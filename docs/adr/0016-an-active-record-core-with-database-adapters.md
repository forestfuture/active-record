# An Active Record core with one adapter per database

The library splits into `@forestfuture/active-record`, which holds Models, Relations, validations, callbacks and associations, and one adapter per database: `@forestfuture/d1-record` and `@forestfuture/pg-record` (#260). An adapter holds its driver, its SQL dialect, its type mapping, its constraint errors and its schema reader. The generated schema names the adapter, so regenerating it moves an app to another database with its Models and application code unchanged.

The reason is lock-in. An app on d1-record that outgrew D1 had no way forward except rewriting its data handling, yet most of the library never depended on D1.

The public API stays Active Record: a record saves itself. We looked at Data Mapper, where a separate object saves it (`userRepository.save(user)`). It keeps classes and tables independent of each other, which isn't the problem here. Attributes come straight from the schema (ADR-0010), and moving databases doesn't need a different API, only a layer beneath the one people already call. A strict reading of Fowler wouldn't call that layer a Data Mapper, because a record still knows how to save itself.

Adapters are pure adapters, with the core as a peer dependency. Re-exporting the core from each one would have kept old imports working, but could install two copies of it, and the library relies on `instanceof` and symbols.

## Consequences

- **A breaking release.** Imports change, and `npx d1-record` becomes `npx active-record`. The library is pre-1.0, so a release note covers it, with no deprecated aliases.
- **D1 and Postgres only.** The core may assume `RETURNING` and `ON CONFLICT`, which leaves MySQL out until someone needs it.
- **One version.** All packages share a version, since the adapter interface is unstable until a third adapter has tested it.
- **One command.** A single `active-record` command finds its adapter from `package.json`, so scripts survive a swap. Adapters supply what differs per database as plugins.
- **Every adapter is tested for real.** ADR-0002's rule now covers each adapter, through a conformance suite.
- **Amends** ADR-0009 (writes resolve to a neutral result), ADR-0010 (schema reading is per adapter), ADR-0011 and ADR-0015 (the base class imports from the core), and ADR-0012 (finding a Model's database moves behind the adapter).
