// A standalone guide page's project (site/snippets/pages/<page>/), and the schema `arbor schema` generates from its migrations.
import { runSchema } from "../../packages/arbor/cli/schema/command.ts";

/** The guide pages laid out as docs/agents/docs-pages.md says, by their project's folder name. */
export const standalonePages = [
  "testing",
  "logging",
  "untrusted-input",
  "shared-behavior",
  "custom-types",
  "errors",
  "connecting",
  "batches",
  "callbacks",
  "validations",
  "persistence",
  "associations",
  "touching",
  "optimistic-locking",
  "read-only",
  "counter-caches",
  "autosaving",
  "preloading",
  "models",
  "serialization",
  "passwords-and-tokens",
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

/** What `arbor schema` exits with, and what it prints, in `cwd`. */
export async function schemaCommand(cwd: string, check = false) {
  const said: string[] = [];
  const code = await runSchema({ cwd, check }, (line) => said.push(line));
  return { code, said: said.join("\n") };
}
