// The project's own config file (`active-record.jsonc`), and reading JSON with comments and trailing commas, as it allows.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { ProjectDatabases } from "../adapter.ts";

/** The project's config file's name, which `--config` replaces. */
export const configFileName = "active-record.jsonc";

/** JSON with `//` and `/* *\/` comments and trailing commas. */
export function parseJsonc(text: string): unknown {
  let out = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"') {
      const end = endOfString(text, index);
      out += text.slice(index, end);
      index = end - 1;
    } else if (text.startsWith("//", index) || text.startsWith("/*", index)) {
      index = endOfComment(text, index) - 1;
    } else {
      if (char === "}" || char === "]") out = withoutTrailingComma(out);
      out += char;
    }
  }
  return JSON.parse(out);
}

/** Just past the comment starting at `start`, keeping a line comment's newline. */
function endOfComment(text: string, start: number): number {
  if (text[start + 1] === "/") {
    const newline = text.indexOf("\n", start);
    return newline < 0 ? text.length : newline;
  }
  const end = text.indexOf("*/", start + 2);
  if (end < 0) throw new SyntaxError("Unterminated /* comment");
  return end + 2;
}

/** `out` without a comma that only whitespace follows, which a `}` or `]` is about to close. */
function withoutTrailingComma(out: string): string {
  let index = out.length - 1;
  while (index >= 0 && /\s/.test(out[index]!)) index--;
  return out[index] === "," ? out.slice(0, index) + out.slice(index + 1) : out;
}

/** Just past the string literal starting at `start`. */
function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
  return index + 1;
}

/** The project's config, read: the file, its folder, and its settings. */
interface ProjectConfig {
  file: string;
  dir: string;
  settings: Record<string, unknown>;
}

/**
 * The project's `active-record.jsonc` in `cwd`, or the file `configPath` names; undefined when
 * there's none, or why it can't be read.
 */
function readProjectConfig(cwd: string, configPath?: string): ProjectConfig | string | undefined {
  const file = resolve(cwd, configPath ?? configFileName);
  if (!existsSync(file)) return configPath === undefined ? undefined : `${configPath} isn't there`;
  let settings: unknown;
  try {
    settings = parseJsonc(readFileSync(file, "utf8"));
  } catch (error) {
    return `${basename(file)} couldn't be read: ${(error as Error).message}`;
  }
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return `${basename(file)} isn't an object`;
  }
  return { file, dir: dirname(file), settings: settings as Record<string, unknown> };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The databases the project's `active-record.jsonc` (or the file `configPath` names) declares, each
 * entry an object; or why there are none, saying to run `init` when there's no file.
 */
export function projectDatabases(cwd: string, configPath?: string): ProjectDatabases | string {
  const config = readProjectConfig(cwd, configPath);
  if (config === undefined) {
    return `No ${configFileName} here, which names the project's databases and their adapter: run \`npx active-record init\` to write one`;
  }
  if (typeof config === "string") return config;
  const name = basename(config.file);
  const { databases } = config.settings;
  if (!isObject(databases) || Object.keys(databases).length === 0) {
    return `${name} has no databases`;
  }
  const wrong = Object.keys(databases).find((binding) => !isObject(databases[binding]));
  if (wrong !== undefined) return `${name}: databases.${wrong} isn't an object`;
  return {
    file: config.file,
    dir: config.dir,
    databases: databases as ProjectDatabases["databases"],
  };
}
