import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { runConsole } from "../../packages/active-record/cli/console/command.ts";
import { terminalStreams } from "../support/console.ts";
import { scratchDirs } from "../support/scratch.ts";
import { configured, remoteDatabase } from "./support.ts";
import { libraryPaths } from "../support/library-paths.ts";

const scratch = scratchDirs();

/** A project whose one D1 binding is `entry`, with a User Model on this run's users table. */
function project(table: string, entry: Record<string, unknown>): string {
  const cwd = scratch("console-remote-smoke-");
  const files: Record<string, string> = {
    "wrangler.jsonc": JSON.stringify({ d1_databases: [{ binding: "DB", ...entry }] }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { paths: libraryPaths },
    }),
    "src/models/application-record.ts": `
      import { Model } from "@forestfuture/active-record";
import { d1 } from "@forestfuture/d1-record";
      export abstract class ApplicationRecord extends Model {
        static override schema = {
          adapter: d1({ binding: "DB" }),
          tables: {
            ${JSON.stringify(table)}: { attributes: { id: "integer", email: "string" }, primaryKey: "id" },
          },
          models: { User: ${JSON.stringify(table)} },
        };
      }
    `,
    "src/models/user.ts": `
      import { ApplicationRecord } from "./application-record";
      export class User extends ApplicationRecord { static table = ${JSON.stringify(table)}; }
    `,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  return cwd;
}

/** Runs a remote console on `cwd` over these lines; what it printed, its transcript and exit code. */
async function session(cwd: string, ...lines: string[]) {
  const terminal = terminalStreams();
  const printed: string[] = [];
  const done = runConsole({ cwd, remote: true, yes: true }, (line) => printed.push(line), terminal);
  let results: string[] = [];
  try {
    await terminal.ready();
    for (const line of lines) results.push(await terminal.send(line));
  } catch {
    results = [];
  }
  terminal.input.end();
  return { printed, results, code: await done };
}

const smokeId = process.env["D1_SMOKE_DATABASE_ID"];

// `active-record console --remote` against the real smoke database, through Wrangler's remote proxy:
// what the fake wrangler in tests/integration/cli-console-remote.test.ts stands in for.
// Skipped unless configured (see support.ts).
describe.skipIf(!configured)("the console on a remote D1", () => {
  test("opens the database, and its Models read and write it", async () => {
    const remote = await remoteDatabase();
    try {
      const cwd = project(`${remote.prefix}users`, {
        database_name: "d1-record-smoke",
        database_id: smokeId,
      });

      const { printed, results, code } = await session(
        cwd,
        'await User.create({ id: 1, email: "console@example.com" })',
        "(await User.find(1)).email",
      );

      expect(printed[0]).toMatch(/^Remote database DB \(d1-record-smoke, id /);
      expect(results[1]).toBe("#=> 'console@example.com'");
      expect(code).toBe(0);
    } finally {
      await remote.dispose();
    }
  }, 180_000);

  test("opens the preview_database_id in place of the database_id, and keeps nothing locally", async () => {
    const remote = await remoteDatabase();
    try {
      // The database_id is one that doesn't exist: only the preview id can have been opened.
      const cwd = project(`${remote.prefix}users`, {
        database_name: "d1-record-smoke",
        database_id: "00000000-0000-4000-8000-000000000000",
        preview_database_id: smokeId,
      });

      const { printed, results, code } = await session(cwd, "await User.count()");

      expect(printed[0]).toMatch(/^Remote preview database DB \(/);
      expect(results).toEqual(["#=> 0"]);
      expect(code).toBe(0);
      expect(existsSync(join(cwd, ".wrangler/state"))).toBe(false);
    } finally {
      await remote.dispose();
    }
  }, 180_000);

  test("carries the config's account_id to Wrangler", async () => {
    const remote = await remoteDatabase();
    try {
      const cwd = project(`${remote.prefix}users`, {
        database_name: "d1-record-smoke",
        database_id: smokeId,
      });
      const config = join(cwd, "wrangler.jsonc");
      writeFileSync(
        config,
        JSON.stringify({
          account_id: process.env["CLOUDFLARE_ACCOUNT_ID"],
          d1_databases: [{ binding: "DB", database_name: "d1-record-smoke", database_id: smokeId }],
        }),
      );

      const { results, code } = await session(cwd, "await User.count()");

      expect(results).toEqual(["#=> 0"]);
      expect(code).toBe(0);
    } finally {
      await remote.dispose();
    }
  }, 180_000);

  test("says how to sign in when Cloudflare refuses the token", async () => {
    const token = process.env["CLOUDFLARE_API_TOKEN"];
    process.env["CLOUDFLARE_API_TOKEN"] = "not-a-token";
    try {
      const cwd = project("users", { database_name: "d1-record-smoke", database_id: smokeId });
      const printed: string[] = [];

      const code = await runConsole(
        { cwd, remote: true, yes: true },
        (line) => printed.push(line),
        terminalStreams(),
      );

      expect(code).toBe(1);
      expect(printed.join("\n")).toMatch(/Sign in with 'wrangler login'/);
    } finally {
      process.env["CLOUDFLARE_API_TOKEN"] = token;
    }
  }, 180_000);
});
