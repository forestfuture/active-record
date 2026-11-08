// The extensions a database's migrations create, and PGlite's own builds of those it has.
import type { Extension, Extensions } from "@electric-sql/pglite";
import type { Migration } from "@forestfuture/active-record/cli";

/** The contrib extensions PGlite has its own build of, by the module it exports each from. */
const contrib = new Set(
  (
    "amcheck auto_explain bloom btree_gin btree_gist citext cube dict_int dict_xsyn " +
    "earthdistance file_fdw fuzzystrmatch hstore intarray isn lo ltree moddatetime pageinspect " +
    "pg_buffercache pg_freespacemap pg_stat_statements pg_surgery pg_trgm pg_visibility " +
    "pg_walinspect pgcrypto seg tablefunc tcn tsm_system_rows tsm_system_time unaccent uuid_ossp"
  ).split(" "),
);

/** `CREATE EXTENSION [IF NOT EXISTS] name`, its name quoted or not. */
const createExtension = /\bcreate\s+extension\s+(?:if\s+not\s+exists\s+)?(?:"([^"]+)"|([\w-]+))/gi;

/** The extensions the migrations create, by name, in the order they first appear. */
export function extensionsIn(migrations: readonly Migration[]): string[] {
  const names = migrations.flatMap(({ sql }) =>
    [...sql.matchAll(createExtension)].map((match) => (match[1] ?? match[2]!).toLowerCase()),
  );
  return [...new Set(names)];
}

/** The PGlite module an extension's build is in (`uuid-ossp` → `uuid_ossp`), if it has one. */
function moduleOf(name: string): string | undefined {
  const module = name.replaceAll("-", "_");
  return contrib.has(module) ? module : undefined;
}

/** PGlite's builds of the extensions the migrations create, as its `extensions` option takes them. */
export async function pgliteExtensions(migrations: readonly Migration[]): Promise<Extensions> {
  const loaded: Extensions = {};
  for (const name of extensionsIn(migrations)) {
    const module = moduleOf(name);
    if (module === undefined) continue;
    const exported = (await import(`@electric-sql/pglite/contrib/${module}`)) as Record<
      string,
      Extension
    >;
    loaded[module] = exported[module]!;
  }
  return loaded;
}
