// The project's own config file (`active-record.jsonc`), and reading JSON with comments and trailing commas, as it allows.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

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
    } else if (text.startsWith("//", index)) {
      index = text.indexOf("\n", index) - 1;
      if (index < 0) break;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      if (end < 0) throw new SyntaxError("Unterminated /* comment");
      index = end + 1;
    } else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** Just past the string literal starting at `start`. */
function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
  return index + 1;
}

/** The project's config, read: the file, its folder, and its settings. */
export interface ProjectConfig {
  file: string;
  dir: string;
  settings: Record<string, unknown>;
}

/**
 * The project's `active-record.jsonc` in `cwd`, or the file `configPath` names; undefined when
 * there's none, or why it can't be read.
 */
export function readProjectConfig(
  cwd: string,
  configPath?: string,
): ProjectConfig | string | undefined {
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
