import { describe, expect, test } from "vite-plus/test";
import { everySubcommand, main } from "../../packages/active-record/cli/main.ts";
import { defineSubcommand, helpFor } from "../../packages/active-record/cli/subcommand.ts";

/** `active-record --help`, as it reads today: the commands, the columns, and each one's flags. */
const help = `Usage:
  active-record schema [options]              Generate src/db/schema.ts from your migrations
  active-record g model <Name> [columns]      Write a CREATE TABLE migration and a Model
  active-record g migration <Name> [columns]  Write a migration: Create…, Add…To…, Remove…From…, or empty
  active-record console (or c)                Open a console on your database, with your Models
  active-record migrate                       Apply your pending migrations to the local database

Columns are name:type, where the type is string (the default), integer, real, boolean,
datetime, json or references; then ! for NOT NULL, =value for a default, and :unique or
:index for an index. For example: email:string!:unique active:boolean!=false user:references

Options for schema:
  --check             Fail if the generated schema is out of date (for CI)
  --watch             Regenerate whenever a migration changes
  --out <file>        Write here instead (a folder, with several databases)
  --migrations <dir>  Read migrations from here instead
  --models <dir>      Write ApplicationRecord here (src/models by default)

Options for g:
  --id integer        Give the table an integer key the database generates (a key made in code by default)
  --no-timestamps     Leave out created_at and updated_at
  --models <path>     Write Models here (src/models), or append them to one file (src/models.ts);
                      ApplicationRecord is imported from the same folder
  --database <name>   The database to use, when the config has several
  --out <file>        The schema file to regenerate, when it isn't src/db/schema.ts

Options for console:
  --database <name>   The database to open, when the config has several
  --models <path>     Where the Models are: a folder (src/models) or one file (src/models.ts)
  --remote            Open your remote database instead, after asking you to type its name
  --yes               Don't ask first (with --remote); also how to open it without a terminal
  --history           Keep what you type, which a remote session doesn't unless asked
  --no-history        Don't keep what you type
  --verbose           Print each statement a line runs (.verbose toggles it while it runs)
  -e, --eval <code>   Run this code, print its result, and exit (only the result goes to stdout)

Options for migrate:
  --database <name>   The database to migrate, when the config has several
  --remote            Migrate your remote database instead, after asking you to type its name
  --yes               Don't ask first (with --remote); also how to migrate it without a terminal

Options for every command:
  --adapter <name>    The adapter, when the project has several installed
  --config <file>     Use this config file, in place of the one the adapter finds
  -h, --help          Show this help`;

describe("active-record's help", () => {
  test("--help prints the usage, word for word", () => {
    const output: string[] = [];

    expect(main(["--help"], (line) => output.push(line))).toBe(0);
    expect(output).toEqual([help]);
  });

  test("an unknown flag prints what went wrong, then the whole usage", () => {
    const output: string[] = [];

    expect(main(["schema", "--chek"], (line) => output.push(line))).toBe(1);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatch(/^Unknown option '--chek'/);
    expect(output[0]?.endsWith(`\n\n${help}`)).toBe(true);
  });
});

/** Whether `help` mentions `flag` (and not only a longer flag that ends in it). */
function mentions(help: string, flag: string): boolean {
  return new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(help);
}

describe.each(everySubcommand.map((subcommand) => [subcommand.usage.trim(), subcommand] as const))(
  "%s: its help and its flags",
  (_, subcommand) => {
    const help = helpFor([subcommand]);

    test("every flag it takes is in its help", () => {
      for (const [name, option] of Object.entries(subcommand.options)) {
        expect(mentions(help, `--${name}`), `--${name}`).toBe(true);
        if (option.short !== undefined) {
          expect(help, `-${option.short}`).toContain(`-${option.short}, --${name}`);
        }
      }
    });

    test("every flag its help names, it takes", () => {
      const named = [...help.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)].map((match) => match[1]);

      expect(named.length).toBeGreaterThan(0);
      for (const name of named)
        expect(Object.keys(subcommand.options), `--${name}`).toContain(name);
    });
  },
);

describe("a subcommand's parsed flags", () => {
  test("are typed from its options: a flag it doesn't take is a type error", () => {
    const seen: unknown[] = [];
    const subcommand = defineSubcommand({
      options: { out: { type: "string" } },
      usage: "",
      flagHelp: "",
      action({ values }) {
        const out: string | undefined = values.out;
        const config: string | undefined = values.config;
        // @ts-expect-error -- not one of its flags
        seen.push(out, config, values.nope);
        return 0;
      },
    });

    expect(
      subcommand.run(
        ["--out", "a.ts"],
        () => {},
        () => 1,
      ),
    ).toBe(0);
    expect(seen).toEqual(["a.ts", undefined, undefined]);
  });
});
