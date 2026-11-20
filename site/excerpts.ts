// Writes the guide's code examples into docs/_excerpts, for its pages' <include>s: each region of a
// snippet file with the imports it uses, and every snippet file whole. Run before blume dev and build.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** An import statement, split into its names so each example shows only the ones it uses. */
interface Import {
  source: string;
  names: string[]; // as written: `hasMany`, `type Database`, `* as d1`, a default import
}

const importPattern = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+(["'][^"']+["']);?\s*$/gm;

function importsOf(code: string): Import[] {
  return [...code.matchAll(importPattern)].map(([, typeOnly = "", clause, source]) => {
    const prefix = typeOnly ? "type " : "";
    const braces = /\{([\s\S]*)\}/.exec(clause!);
    const named =
      braces?.[1]
        ?.split(",")
        .map((name) => name.trim())
        .filter(Boolean) ?? [];
    const bare = clause!
      .replace(/\{[\s\S]*\}/, "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    return { source: source!, names: [...bare, ...named].map((name) => prefix + name) };
  });
}

/** The binding a name introduces: `type Database` → Database, `* as d1` → d1. */
function bindingOf(name: string): string {
  return name
    .replace(/^type\s+/, "")
    .split(/\s+as\s+/)
    .pop()!
    .replace(/^\*\s*/, "");
}

/** The lines between `// #region name` and `// #endregion name`, every part of it, dedented. */
function regionOf(code: string, name: string): string | undefined {
  const parts: string[] = [];
  const pattern = new RegExp(
    `^[ \\t]*// #region ${name}\\n([\\s\\S]*?)^[ \\t]*// #endregion ${name}$`,
    "gm",
  );
  for (const [, body] of code.matchAll(pattern)) parts.push(dedent(body!.replace(/\n$/, "")));
  return parts.length === 0 ? undefined : parts.join("\n\n");
}

function dedent(text: string): string {
  const lines = text.split("\n");
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => /^\s*/.exec(line)![0].length),
  );
  return lines.map((line) => line.slice(indent)).join("\n");
}

/** Code without its line comments and quoted strings, so only real uses of a name count. */
function codeOnly(code: string): string {
  return code.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\/.*$/gm, "");
}

/**
 * Where an import is shown from. In a page's project (`pages/<page>/`), its `src/` is the app's,
 * so `./src/models/user` is `./models/user`. Elsewhere, the app's base class, its schema, or its
 * models.
 */
function shownSource(source: string): string {
  if (/^["']\.\/src\//.test(source)) return source.replace("/src/", "/");
  if (!/^["']\./.test(source)) return source;
  if (/\/schema["']$/.test(source)) return source;
  if (/\/application-record["']$/.test(source)) return '"./application-record"';
  return '"./models"';
}

/**
 * An example as shown: the snippet file's imports that the region uses, then the region. So
 * every example says where its names come from, and both come from the type-checked file.
 * The snippets' own model files (any relative import) are shown as the app's: `./models`. The
 * generated schema (`../db/schema`) and the app's base class (`./application-record`) are
 * shown where an app imports them from.
 */
export function exampleBlock(file: string, region: string): string | undefined {
  const code = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  const body = regionOf(code, region);
  if (body === undefined) return undefined;
  const uses = codeOnly(body);
  const used = (name: string) => new RegExp(`\\b${bindingOf(name)}\\b`).test(uses);
  const bySource = new Map<string, string[]>();
  const add = (source: string, names: string[]) =>
    bySource.set(source, [...(bySource.get(source) ?? []), ...names]);
  for (const { source, names } of importsOf(code)) add(shownSource(source), names.filter(used));
  const imports = [...bySource]
    .filter(([, names]) => names.length > 0)
    .map(([source, names]) => `import { ${names.join(", ")} } from ${source};`);
  return imports.length === 0 ? body : `${imports.join("\n")}\n\n${body}`;
}

/** A page project's `src/` files, the folder that holds them, as Twoslash files; undefined elsewhere. */
function projectFiles(file: string): string | undefined {
  const root = /^(.*\/pages\/[^/]+)\/[^/]+\.ts$/.exec(file)?.[1];
  if (root === undefined) return undefined;
  const src = join(root, "src");
  return readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => `// @filename: ${name}\n${readFileSync(join(src, name), "utf8").trimEnd()}`)
    .join("\n\n");
}

/**
 * An example for a `twoslash` fence, from a page's project (`pages/<page>/examples.ts`): the
 * project's `src/` files, hidden, then the example as exampleBlock shows it. Readers hover the
 * example's names for their inferred types, and the build fails if the example doesn't
 * type-check. Undefined outside a page's project.
 */
export function twoslashBlock(file: string, region: string): string | undefined {
  const files = projectFiles(file);
  const example = exampleBlock(file, region);
  if (files === undefined || example === undefined) return undefined;
  // An expected error was proven by the type check: Twoslash shows it rather than failing on it.
  const expectsError = example.includes("// @ts-expect-error");
  const shown = example.replace(/^\/\/ @ts-expect-error.*\n/gm, "");
  const flags = expectsError ? "// @noErrorValidation\n" : "";
  return `${flags}${files}\n\n// @filename: example.ts\n// ---cut---\n${shown}`;
}

const regionName = /^[ \t]*\/\/ #region ([\w-]+)$/gm;

/** A snippet file's region names, each once. */
function regionsOf(code: string): string[] {
  return [...new Set([...code.matchAll(regionName)].map(([, name]) => name!))];
}

/** The agent skill's rules (SKILL.md's "rules" region), which the AI agents page shows. */
function skillRules(site: string): string {
  const skill = readFileSync(
    join(site, "../packages/active-record/skills/active-record/SKILL.md"),
    "utf8",
  );
  const rules = /<!-- #region rules -->\r?\n([\s\S]*?)<!-- #endregion rules -->/.exec(skill)?.[1];
  if (rules === undefined)
    throw new Error("packages/active-record/skills/active-record/SKILL.md has no rules region");
  return rules;
}

/**
 * Rewrites `out` (docs/_excerpts) from snippets/: `guide/models/declare.ts` is
 * snippets/guide/models.ts's `declare` region as exampleBlock shows it, `guide/models.ts` the file
 * itself, and `skill-rules.md` the agent skill's rules. Blume publishes no `_` folder, and an
 * <include> must read from inside the content root.
 */
export function writeExcerpts(site: string, out = join(site, "docs/_excerpts")): void {
  const snippets = join(site, "snippets");
  rmSync(out, { recursive: true, force: true });
  cpSync(snippets, out, { recursive: true });
  for (const name of readdirSync(snippets, { recursive: true, encoding: "utf8" })) {
    if (!name.endsWith(".ts")) continue;
    const file = join(snippets, name);
    for (const region of regionsOf(readFileSync(file, "utf8"))) {
      const excerpt = join(out, name.slice(0, -".ts".length), `${region}.ts`);
      mkdirSync(dirname(excerpt), { recursive: true });
      writeFileSync(excerpt, `${exampleBlock(file, region)}\n`);
      const twoslash = twoslashBlock(file, region);
      if (twoslash !== undefined)
        writeFileSync(excerpt.replace(/\.ts$/, ".twoslash.ts"), `${twoslash}\n`);
    }
  }
  writeFileSync(join(out, "skill-rules.md"), skillRules(site));
}

export const site = import.meta.dirname;

if (process.argv[1] === fileURLToPath(import.meta.url)) writeExcerpts(site);
