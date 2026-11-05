import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  migrationTool,
  toolsWithFiles,
  type Tool,
} from "../../packages/active-record/cli/project/tools.ts";
import { originNotes } from "../../packages/active-record/cli/schema/origin.ts";
import type { Migration } from "../../packages/active-record/cli/project/migrations.ts";
import { schemaOf } from "../../packages/d1-record/cli/schema.ts";

/** A throwaway project folder with these files. */
function projectWith(...files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "d1-record-origin-"));
  for (const file of files) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), "");
  }
  return dir;
}

/** The tool recognised for a project folder and its migrations, as `active-record schema` reads them. */
function recognised(dir: string, migrations: readonly Migration[]): Tool | undefined {
  return migrationTool(toolsWithFiles(dir), migrations);
}

const plain = [{ name: "0001_init.sql", sql: "CREATE TABLE users (id TEXT PRIMARY KEY);" }];

describe("recognising another tool's migrations", () => {
  test("Drizzle, by its config file or the statement breakpoints it writes", () => {
    expect(recognised(projectWith("drizzle.config.ts"), plain)).toBe("Drizzle");
    expect(
      recognised(projectWith(), [
        {
          name: "0000_init.sql",
          sql: "CREATE TABLE a (id INTEGER PRIMARY KEY);\n--> statement-breakpoint\nCREATE TABLE b (id INTEGER PRIMARY KEY);",
        },
      ]),
    ).toBe("Drizzle");
  });

  test("Prisma, by its schema or config file, or the step comments it writes", () => {
    expect(recognised(projectWith("prisma/schema.prisma"), plain)).toBe("Prisma");
    expect(recognised(projectWith("prisma.config.ts"), plain)).toBe("Prisma");
    expect(
      recognised(projectWith(), [
        {
          name: "0001_init.sql",
          sql: '-- CreateTable\nCREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY);',
        },
      ]),
    ).toBe("Prisma");
  });

  test("a config with any of Drizzle's extensions, or Prisma's schema at the root, counts", () => {
    expect(recognised(projectWith("drizzle.config.mts"), plain)).toBe("Drizzle");
    expect(recognised(projectWith("drizzle.config.cts"), plain)).toBe("Drizzle");
    expect(recognised(projectWith("schema.prisma"), plain)).toBe("Prisma");
  });

  test("in a monorepo, a config above the project counts, up to the repository's root", () => {
    const repo = projectWith(".git/HEAD", "drizzle.config.ts", "apps/api/wrangler.jsonc");
    const outside = projectWith("drizzle.config.ts", "apps/api/wrangler.jsonc");

    expect(recognised(join(repo, "apps/api"), plain)).toBe("Drizzle");
    expect(recognised(join(outside, "apps/api"), plain)).toBeUndefined();
  });

  test("Wrangler's own migrations aren't another tool's", () => {
    expect(recognised(projectWith("wrangler.jsonc"), plain)).toBeUndefined();
  });
});

describe("notes for another tool's migrations", () => {
  const result = schemaOf([
    {
      name: "0000_init.sql",
      sql: `CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT,
        metadata TEXT,
        published_at INTEGER,
        created_at DATETIME,
        "updatedAt" INTEGER,
        "payloadJson" TEXT,
        data TEXT,
        config TEXT
      );`,
    },
  ]);
  const tables = result.ok ? result.tables : [];

  test("the tool, then each column to check: numeric timestamps, and JSON in plain TEXT, named either way", () => {
    expect(originNotes("Drizzle", tables, [])).toEqual([
      "these migrations look like Drizzle's. Some columns may convert to the wrong type and fail when read, especially numeric timestamps: check the generated types (https://github.com/forestfuture/active-record/issues/73)",
      'posts.metadata: read as a string; if it holds JSON, override it as "json" in its Model',
      'posts.published_at: read as an integer; if it holds a Unix timestamp, override it in its Model as { type: "datetime", storage: "unixSeconds" ("timestamp") or "unixMilliseconds" ("timestamp_ms") }',
      'posts.updatedAt: read as an integer; if it holds a Unix timestamp, override it in its Model as { type: "datetime", storage: "unixSeconds" ("timestamp") or "unixMilliseconds" ("timestamp_ms") }',
      'posts.payloadJson: read as a string; if it holds JSON, override it as "json" in its Model',
    ]);
  });

  test("for Prisma, an integer timestamp's note doesn't name Drizzle's modes", () => {
    expect(originNotes("Prisma", tables, [])).toContain(
      'posts.published_at: read as an integer; if it holds a Unix timestamp, override it in its Model as { type: "datetime", storage: "unixSeconds" or "unixMilliseconds" }',
    );
  });

  test("for Prisma, a DATETIME column gets no note, since Prisma writes it as ISO text", () => {
    expect(originNotes("Prisma", tables, []).join("\n")).not.toContain("created_at");
  });

  test("a column with an expression default, as Drizzle writes for a timestamp, converts and is noted", () => {
    const stamped = schemaOf([
      {
        name: "0000_init.sql",
        sql: `CREATE TABLE posts (
          id INTEGER PRIMARY KEY,
          created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
          published_at INTEGER
        );`,
      },
    ]);

    expect(stamped.ok && stamped.tables[0]?.attributes).toMatchObject({
      createdAt: { type: "integer", null: false },
      publishedAt: { type: "integer" },
    });
    expect(originNotes("Drizzle", stamped.ok ? stamped.tables : [], [])).toHaveLength(3);
  });

  test("a datetime defaulting to SQLite's date text is noted, naming the two forms and the guide (#143)", () => {
    expect(originNotes("Prisma", tables, ["posts.created_at"])).toContain(
      "posts.created_at: its default writes SQLite's date text (2026-10-12 06:38:30), where d1-record writes ISO text (2026-10-12T06:38:30.000Z), and the two sort apart as text, so range conditions can misplace values within a day (see Existing databases in the guide)",
    );
  });

  test("Drizzle's migrations get the date text note too (#143)", () => {
    expect(originNotes("Drizzle", tables, ["posts.created_at"]).join("\n")).toContain(
      "posts.created_at: its default writes SQLite's date text",
    );
  });

  test("without a recognised tool there's no date text note, since it's a hint (#143)", () => {
    expect(originNotes(undefined, tables, ["posts.created_at"])).toEqual([]);
  });

  test("none for Wrangler's own migrations", () => {
    expect(originNotes(undefined, tables, [])).toEqual([]);
  });
});
