// A throwaway Postgres project for the command's tests: its package.json lists pg-record, its tsconfig finds this repo's packages, and active-record.jsonc declares its databases.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { libraryPaths } from "./library-paths.ts";

const source = (path: string) => [new URL(`../../packages/${path}`, import.meta.url).pathname];

/** The packages a Postgres project imports, at their source in this repo. */
const pgPaths = {
  ...libraryPaths,
  "@forestfuture/pg-record": source("pg-record/src/index.ts"),
  "@forestfuture/pg-record/cli": source("pg-record/cli/plugin.ts"),
};

/** The project's databases, as active-record.jsonc declares them, by binding. */
export type PgDatabases = Record<string, Record<string, string>>;

/**
 * Writes a Postgres project in `cwd` (a folder outside the repo, so only these paths find the
 * library): its files by path, after its package.json, tsconfig.json and active-record.jsonc.
 */
export function writePgProject(
  cwd: string,
  databases: PgDatabases,
  files: Record<string, string> = {},
): string {
  const all = {
    "package.json": JSON.stringify({
      dependencies: { "@forestfuture/active-record": "*", "@forestfuture/pg-record": "*" },
    }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: pgPaths } }),
    "active-record.jsonc": JSON.stringify({ databases }, null, 2),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  return cwd;
}
