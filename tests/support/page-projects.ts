// A standalone guide page's project (site/snippets/pages/<page>/): its migrations, and the schema `active-record schema` generates from them.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runSchema } from "../../packages/active-record/cli/schema/command.ts";

/** The guide pages laid out as docs/agents/docs-pages.md says, by their project's folder name. */
export const standalonePages = [
  "touching",
  "counter-caches",
  "autosaving",
  "preloading",
  "models",
  "serialization",
  "change-tracking",
  "enums",
  "attribute-types",
  "querying",
  "conditions",
  "through-associations",
  "ordering-and-pagination",
  "batch-iteration",
  "calculations",
  "scopes",
  "joins",
  "raw-statements",
];

/** A page's project folder, or a path in it. */
export const pageProject = (page: string, path = "") =>
  new URL(`../../site/snippets/pages/${page}/${path}`, import.meta.url);

/** A page's migrations, in order: its D1 ones (`migrations`) or its Postgres ones (`postgres`). */
export function pageMigrations(page: string, folder: "migrations" | "postgres"): URL[] {
  const dir = pageProject(page, `${folder}/`);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => new URL(name, dir));
}

/** What `active-record schema` exits with, and what it prints, in `cwd`. */
export async function schemaCommand(cwd: string, check = false) {
  const said: string[] = [];
  const code = await runSchema({ cwd, check }, (line) => said.push(line));
  return { code, said: said.join("\n") };
}

/** Each table's attributes in a project's generated schema, one trimmed line each. */
export function generatedAttributes(cwd: string): Record<string, string[]> {
  const schema = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
  const tables = schema.matchAll(/^export const (\w+) = \{\n([\s\S]*?)\n\} as const;/gm);
  return Object.fromEntries(
    [...tables].map(([, table, body]) => [table!, body!.split("\n").map((line) => line.trim())]),
  );
}
