import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const root = join(import.meta.dirname, "../..");
const command = join(root, "packages/active-record/cli");

/** A database, its tools, or an adapter's package, named anywhere in the code or its comments. */
const databaseName = /\b(d1|wrangler|sqlite|postgres(ql)?|pg|pglite|hyperdrive|miniflare)\b/i;

/** The registry of adapters `--adapter` names, which is how the command finds their packages. */
const registry = /^const adapters: [^\n]*\{\n(?:[^\n]*\n)*?\};$/m;

/** Every TypeScript file in a folder and the folders in it. */
function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesIn(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** Each line of a file that names a database, as `path:line: text`. */
function namings(file: string): string[] {
  const source = readFileSync(file, "utf8").replace(registry, "");
  return source
    .split("\n")
    .flatMap((line, index) =>
      databaseName.test(line) ? [`${relative(root, file)}:${index + 1}: ${line.trim()}`] : [],
    );
}

// The command works for any adapter; what's true of one database is its plugin's to say (#284).
describe("the core's command", () => {
  test("names no database, its tools or an adapter, outside the registry of adapters", () => {
    expect(filesIn(command).flatMap(namings)).toEqual([]);
  });
});
