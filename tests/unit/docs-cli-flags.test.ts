import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParseArgsOptionsConfig } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { everySubcommand } from "../../packages/d1-record/cli/main.ts";

const page = "site/docs/(basics)/command-line.mdx";
const commandLinePage = readFileSync(join(import.meta.dirname, "../..", page), "utf8");

/** Flags left out of both sides: the guide shows `--help` in its intro, not in a table. */
const unlisted = new Set(["help"]);

/** A command's name, from its usage line: `schema`, `g` or `console`. */
function commandName(usage: string): string {
  const name = /d1-record (\w+)/.exec(usage)?.[1];
  if (name === undefined) throw new Error(`No command name in: ${usage}`);
  return name;
}

/** The page's one section for a command, from its `## \`d1-record <name>` heading to the next `## `. */
function sectionFor(name: string): string {
  const heading = new RegExp(`^## \`d1-record ${name}[\` ]`);
  const sections = commandLinePage.split(/^(?=## )/m).filter((part) => heading.test(part));
  if (sections.length !== 1) {
    throw new Error(`${page} has ${sections.length} "## \`d1-record ${name}" sections, not one`);
  }
  return sections[0] ?? "";
}

/** The flags a command's section lists, as written: `--check`, or `-e, --eval`. */
function guideFlags(name: string): string[] {
  return [...sectionFor(name).matchAll(/^\| `((?:-\w, )?--([a-z][a-z-]*))/gm)]
    .filter((match) => !unlisted.has(match[2] ?? ""))
    .map((match) => match[1] ?? "");
}

/** Each flag a command takes, written as its help writes it: `--check`, or `-e, --eval`. */
function flagsTaken(options: ParseArgsOptionsConfig): string[] {
  return Object.entries(options)
    .filter(([name]) => !unlisted.has(name))
    .map(([name, option]) =>
      option.short === undefined ? `--${name}` : `-${option.short}, --${name}`,
    );
}

describe.each(
  everySubcommand.map((subcommand) => [commandName(subcommand.usage), subcommand] as const),
)(`d1-record %s: the flags in ${page}`, (name, subcommand) => {
  const taken = flagsTaken(subcommand.options);
  const listed = guideFlags(name);

  test("lists every flag it takes", () => {
    for (const flag of taken) expect(listed, `${flag} has no row`).toContain(flag);
  });

  test("lists only flags it takes", () => {
    expect(listed.length).toBeGreaterThan(0);
    for (const flag of listed) expect(taken, `${flag} isn't a flag it takes`).toContain(flag);
  });
});
