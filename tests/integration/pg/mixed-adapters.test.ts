import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { runConsole } from "../../../packages/active-record/cli/console/command.ts";
import { runMigrate } from "../../../packages/active-record/cli/migrate/command.ts";
import { runSchema } from "../../../packages/active-record/cli/schema/command.ts";
import { Model, withDatabase } from "../../../packages/active-record/src/index.ts";
import { connect, d1 } from "../../../packages/active-record/src/adapters/d1/index.ts";
import {
  connect as connectPostgres,
  postgresql,
} from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import { capturedStreams } from "../../support/console.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";
import { writePgProject } from "../../support/pg-project.ts";
import { scratchDirs } from "../../support/scratch.ts";

// PGlite starts for each schema read, which takes seconds with coverage on.
const pgliteTimeout = { timeout: 60_000 };

const scratch = scratchDirs();
const quiet = () => {};

// The Postgres side of a project whose databases use different adapters (#305). Its D1 side, which
// needs no server, is in tests/integration/d1/cli-mixed-adapters.test.ts.
describe("migrate and console on a mixed project's Postgres database", pgliteTimeout, () => {
  let schema: PgSchema;
  let cwd: string;
  beforeAll(async () => {
    schema = await openPgSchema([]);
    // Inside the repo, so `schema` finds the Models by the base classes it wrote.
    cwd = writePgProject(
      scratch("pg-mixed-"),
      { DB: { adapter: "d1" }, HYPERDRIVE: { url: schema.url, migrationsDir: "pg-migrations" } },
      {
        "wrangler.jsonc": JSON.stringify({ d1_databases: [{ binding: "DB", database_id: "x" }] }),
        "migrations/0001_posts.sql": "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);",
        "pg-migrations/1_users.sql": "CREATE TABLE users (id UUID PRIMARY KEY, name TEXT);",
      },
    );
    await runSchema({ cwd }, quiet);
    writeFileSync(
      join(cwd, "src/models/post.ts"),
      'import { DbRecord } from "./db-record";\nexport class Post extends DbRecord {}\n',
    );
    writeFileSync(
      join(cwd, "src/models/user.ts"),
      'import { HyperdriveRecord } from "./hyperdrive-record";\nexport class User extends HyperdriveRecord {}\n',
    );
    await runSchema({ cwd }, quiet);
  });
  afterAll(() => schema.dispose());

  test("migrate --database HYPERDRIVE applies its migrations with the PostgreSQL adapter", async () => {
    const { code, applied } = await migrating();

    expect([code, applied]).toEqual([
      0,
      "Local database HYPERDRIVE (active_record_test on localhost)\nApplied 1_users.sql\n",
    ]);
  });

  test("console --database HYPERDRIVE opens it, with every Model", async () => {
    await migrating();
    const streams = capturedStreams();

    const opened = await runConsole(
      {
        cwd,
        database: "HYPERDRIVE",
        eval: 'await User.create({ name: "Ada" }); await User.count()',
      },
      quiet,
      streams,
    );

    expect([opened, streams.seen.stdout]).toEqual([0, "1\n"]);
    expect(streams.seen.stderr).toBe(
      "Local database HYPERDRIVE (active_record_test on localhost)\nModels: Post, User\n",
    );
    const { rows } = await schema.pool.query({ text: "SELECT name FROM users" });
    expect(rows).toEqual([{ name: "Ada" }]);
  });

  /** `migrate --database HYPERDRIVE`: its code, and what the runner printed. */
  async function migrating() {
    const output = new PassThrough();
    let applied = "";
    output.on("data", (chunk: Buffer) => (applied += chunk.toString()));
    const io = { input: new PassThrough(), output, terminal: false };
    const code = await runMigrate({ cwd, database: "HYPERDRIVE" }, quiet, io);
    return { code, applied };
  }
});

abstract class D1Record extends Model {
  static override schema = { adapter: d1({ binding: "DB" }), tables: {} };
}

class Account extends D1Record.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static override table = "users";
}

abstract class PgRecord extends Model {
  static override schema = { adapter: postgresql({ binding: "DATABASE_URL" }), tables: {} };
}

class Member extends PgRecord.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static override table = "users";
}

// Outside a Worker, each Model's statics find the request's database on its own adapter (#305).
describe("a request with a D1 database and a Postgres one", () => {
  let binding: TestDatabase;
  let disposeD1: () => Promise<void>;
  let schema: PgSchema;
  beforeAll(async () => {
    ({ db: binding, dispose: disposeD1 } = await createTestDatabase());
    schema = await openPgSchema();
  });
  afterAll(async () => {
    await disposeD1();
    await schema.dispose();
  });

  test("writes each Model's records to its own database", async () => {
    const counts = await withDatabase([connect(binding), connectPostgres(schema.url)], async () => {
      await Account.create({ email: "d1@example.com" });
      await Member.create({ email: "pg@example.com" });
      return [
        await Account.where({ email: "pg@example.com" }).count(),
        await Member.where({ email: "d1@example.com" }).count(),
      ];
    });

    expect(counts).toEqual([0, 0]);
    const { rows } = await schema.pool.query({ text: "SELECT email FROM users ORDER BY email" });
    expect(rows).toEqual([{ email: "pg@example.com" }]);
    const { results } = await binding.prepare("SELECT email FROM users").all();
    expect(results).toEqual([{ email: "d1@example.com" }]);
  });
});
