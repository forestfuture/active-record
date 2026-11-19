// Checks a standalone guide page's Models against its tables: what `active-record schema` generates from the page's SQL, attribute by attribute.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runSchema } from "../../packages/active-record/cli/schema/command.ts";

/** Each class's `Model.define({ … })` attributes in a snippet file, one trimmed line each. */
function declaredAttributes(snippet: string): Map<string, string[]> {
  const code = readFileSync(
    new URL(`../../site/snippets/guide/${snippet}.ts`, import.meta.url),
    "utf8",
  );
  const classes = code.matchAll(
    /^export class (\w+) extends Model\.define\(\{\n([\s\S]*?)\n\}\)/gm,
  );
  return new Map([...classes].map(([, name, body]) => [name!, lines(body!)]));
}

/** Each table's attributes in a generated schema, one trimmed line each. */
function generatedAttributes(schema: string): Map<string, string[]> {
  const tables = schema.matchAll(/^export const (\w+) = \{\n([\s\S]*?)\n\} as const;/gm);
  return new Map([...tables].map(([, table, body]) => [table!, lines(body!)]));
}

/** An object literal's lines, without comments or indentation. */
const lines = (body: string) =>
  body
    .split("\n")
    .map((line) => line.replace(/\s*\/\/.*$/, "").trim())
    .filter(Boolean);

/**
 * The page's Models next to the attributes generated from its tables, by Model: `cwd` is a
 * project whose migrations hold the page's SQL, and `tableOf` names each Model's table.
 */
export async function pageModelsAndTables(
  cwd: string,
  snippet: string,
  tableOf: (model: string) => string,
): Promise<{ declared: Record<string, string[]>; generated: Record<string, string[]> }> {
  const said: string[] = [];
  const code = await runSchema({ cwd }, (line) => said.push(line));
  if (code !== 0) throw new Error(said.join("\n"));
  const tables = generatedAttributes(readFileSync(join(cwd, "src/db/schema.ts"), "utf8"));
  const declared = Object.fromEntries(declaredAttributes(snippet));
  const generated = Object.fromEntries(
    Object.keys(declared).map((model) => [model, tables.get(tableOf(model)) ?? []]),
  );
  return { declared, generated };
}
