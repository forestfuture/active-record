import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { runConsole } from "../../../packages/active-record/cli/console/command.ts";
import { runGenerate } from "../../../packages/active-record/cli/generate/command.ts";
import { runMigrate } from "../../../packages/active-record/cli/migrate/command.ts";
import { capturedStreams } from "../../support/console.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";
import { writePgProject } from "../../support/pg-project.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();
const quiet = () => {};

// The console on a Postgres project (#285): a project generated, migrated and opened by the command.
describe("console, on Postgres", () => {
  let schema: PgSchema;
  let cwd: string;
  beforeAll(async () => {
    schema = await openPgSchema([]);
    cwd = writePgProject(scratch("pg-console-", true), {
      DB: { url: schema.url, remoteUrl: "${CONSOLE_REMOTE_URL}" },
    });
    await runGenerate({ cwd, kind: "model", name: "Product", columns: ["name:string!"] }, quiet);
    const io = capturedStreams();
    await runMigrate({ cwd }, quiet, { input: io.input, output: io.output, terminal: false });
  });
  afterAll(() => schema.dispose());

  /** What `console -e` printed on each stream, and its exit code. */
  async function evaluating(code: string, options: { remote?: boolean; yes?: boolean } = {}) {
    const { input, output, error, seen } = capturedStreams();
    const said: string[] = [];
    const exitCode = await runConsole({ cwd, eval: code, ...options }, (line) => said.push(line), {
      input,
      output,
      error,
    });
    return { exitCode, ...seen, said };
  }

  test("opens the local database with the project's Models, whose records it saves and finds", async () => {
    const created = await evaluating('(await Product.create({ name: "Lamp" })).name');
    const found = await evaluating("(await Product.first()).name");

    expect([created.exitCode, created.stdout]).toEqual([0, "Lamp\n"]);
    expect(created.stderr).toBe(
      "Local database DB (active_record_test on localhost)\nModels: Product\n",
    );
    expect(found.stdout).toBe("Lamp\n");
    const { rows } = await schema.pool.query({ text: "SELECT name FROM products" });
    expect(rows).toEqual([{ name: "Lamp" }]);
  });

  test("--remote opens the remoteUrl's database, after --yes", async () => {
    vi.stubEnv("CONSOLE_REMOTE_URL", schema.url);
    afterAll(() => void vi.unstubAllEnvs());

    const run = await evaluating("await Product.count()", { remote: true, yes: true });

    expect([run.exitCode, run.stderr.split("\n")[0]]).toEqual([
      0,
      "Remote database DB (active_record_test on localhost)",
    ]);
  });

  test("keeps local files, such as its history, where node_modules is ignored", async () => {
    const { cli } = await import("../../../packages/pg-record/cli/plugin.ts");
    const chosen = {
      binding: "DB",
      entry: {},
      configFile: join(cwd, "active-record.jsonc"),
      migrationsDir: join(cwd, "migrations"),
    };

    expect(cli.stateFolder(chosen)).toBe(join(cwd, "node_modules/.cache/active-record"));
    expect(existsSync(join(cwd, ".wrangler"))).toBe(false);
  });
});
