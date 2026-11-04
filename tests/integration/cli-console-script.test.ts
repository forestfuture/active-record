import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, withDatabase } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/d1-record/src/index.ts";
import { runScript } from "../../packages/d1-record/cli/console/script.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Sample extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
}) {
  static table = "samples";
}

// `d1-record console -e` (#105): one piece of code, its result on stdout, its failure on stderr.
describe("running one piece of code in the console's scope", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM samples").run();
    await binding.prepare("INSERT INTO samples (id, label, quantity) VALUES (1, 'bolt', 36)").run();
  });

  const run = (code: string) =>
    runScript({
      code,
      scope: { Sample, db: connect(binding) },
      withDatabase: (inside) => withDatabase(connect(binding), inside),
    });

  test("prints a string as it is, without quotes", async () => {
    expect(await run("(await Sample.find(1)).label")).toEqual({
      exitCode: 0,
      stdout: "bolt\n",
      stderr: "",
    });
  });

  test("prints a record as the console's inspect does, with no #=>", async () => {
    expect((await run("await Sample.find(1)")).stdout).toBe(
      "Sample { id: 1, label: 'bolt', quantity: 36 }\n",
    );
  });

  test("prints a number as the console's inspect does", async () => {
    expect((await run("await Sample.count()")).stdout).toBe("1\n");
  });

  test("prints nothing for undefined", async () => {
    expect(await run("const unused = 1")).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  test("a Model's statics need no database argument", async () => {
    expect((await run("await Sample.count()")).exitCode).toBe(0);
  });

  test("prints the last statement's value", async () => {
    const result = await run(
      'await Sample.create({ id: 2, label: "nut", quantity: 5 }); await Sample.count()',
    );

    expect(result.stdout).toBe("2\n");
  });

  test("a statement before the last one has taken effect in the database", async () => {
    await run('await Sample.create({ id: 2, label: "nut", quantity: 5 }); 1');

    expect(await binding.prepare("SELECT COUNT(*) AS n FROM samples").first("n")).toBe(2);
  });

  test("a throw prints its stack on stderr, nothing on stdout, and fails", async () => {
    const result = await run('throw new Error("boom")');

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^Error: boom\n\s+at /);
  });

  test("a rejected await prints its stack on stderr, nothing on stdout, and fails", async () => {
    const result = await run("await Sample.find(99)");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/RecordNotFound/);
  });

  test("a rejection with something other than an error prints that", async () => {
    const result = await run('await Promise.reject("plain")');

    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "'plain'\n" });
  });

  test("code that isn't finished fails", async () => {
    const result = await run("const f = () => {");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
  });

  test("after a failure, the lines behind it don't run", async () => {
    const result = await run(
      'throw new Error("stop")\nawait Sample.create({ id: 3, label: "late", quantity: 1 })',
    );

    expect(result.exitCode).toBe(1);
    expect(await binding.prepare("SELECT COUNT(*) AS n FROM samples").first("n")).toBe(1);
  });

  test("a console command line runs and prints nothing, without failing", async () => {
    const result = await runScript({
      code: "verbose!",
      scope: { Sample },
      commands: {
        verbose: { help: "Toggles SQL logging", bang: true, run: () => "SQL logging on" },
      },
      withDatabase: (inside) => withDatabase(connect(binding), inside),
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  test("a REPL command line runs and prints nothing, without failing", async () => {
    expect(await run(".help")).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  test("console.log goes to stdout and console.error to stderr, before the result", async () => {
    const result = await run('console.log("one"); console.error("two"); "three"');

    expect(result).toEqual({ exitCode: 0, stdout: "one\nthree\n", stderr: "two\n" });
  });

  test("what was logged before a failure is still printed, though no result is", async () => {
    const result = await run('console.log("seen"); throw new Error("then this")');

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("seen\n");
  });

  test("a rejection nobody awaits fails the script when it arrives while the code still runs", async () => {
    // Ordered, not timed: D1 answers the count after the lookup; the tick lets the rejection event fire.
    const result = await run(
      "Sample.find(99); await Sample.count(); await new Promise((resolve) => setImmediate(resolve)); 1",
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/RecordNotFound/);
  });

  test("a failure after a result prints no partial result", async () => {
    const result = await run('"first"\nthrow new Error("then this")');

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });
});
