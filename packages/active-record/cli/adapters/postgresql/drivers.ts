// The PostgreSQL adapter's drivers, which an app installs itself as optional peer dependencies (#301): `pg`, loaded when a command first reaches a server, and PGlite, when it reads a schema; or what to install.
import type * as PgliteModule from "@electric-sql/pglite";
import { createRequire } from "node:module";
import type PgModule from "pg";

/** Whether Node's error is for the package `name` itself missing, from `require` or `import`. */
function isMissing(error: unknown, name: string): boolean {
  const { code, message } = error as { code?: unknown; message?: unknown };
  const notFound = code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
  return notFound && String(message).includes(`'${name}'`);
}

/**
 * `pg`, as the library's install has it (the app's own), loaded with `require` so a sync caller can
 * use it; or what to install. A `pg` that fails for any other reason throws.
 */
export function pgDriver(
  load: (id: string) => unknown = createRequire(import.meta.url),
): typeof PgModule | string {
  try {
    return load("pg") as typeof PgModule;
  } catch (error) {
    if (!isMissing(error, "pg")) throw error;
    return "The PostgreSQL adapter needs pg, which isn't installed here: run `npm install pg`";
  }
}

/** PGlite, which reads a schema in memory, as the library's install has it; or what to install. */
export async function pgliteModule(
  load: () => Promise<typeof PgliteModule> = () => import("@electric-sql/pglite"),
): Promise<typeof PgliteModule | string> {
  try {
    return await load();
  } catch (error) {
    if (!isMissing(error, "@electric-sql/pglite")) throw error;
    return "Reading a PostgreSQL schema needs PGlite, which isn't installed here: run `npm install --save-dev @electric-sql/pglite`";
  }
}
