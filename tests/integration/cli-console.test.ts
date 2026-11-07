import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, withDatabase } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/d1-record/src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";
import { startSession } from "../../packages/active-record/cli/console/session.ts";
import { drive, terminalStreams, waitFor } from "../support/console.ts";

class Sample extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
}) {
  static table = "samples";
}

// `active-record console`: a REPL with the project's Models in scope (#104).
describe("the console session", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  // The project's library supplies withDatabase; here that is the repo's own.
  const session = () =>
    drive({
      scope: { Sample, db: connect(binding) },
      withDatabase: (run) => withDatabase(connect(binding), run),
    });
  beforeEach(async () => {
    await binding.prepare("DELETE FROM samples").run();
    await binding.prepare("INSERT INTO samples (id, label, quantity) VALUES (1, 'bolt', 36)").run();
  });

  test("a Model is in scope", async () => {
    const console = await session();

    expect(await console.send("Sample.table")).toBe("#=> 'samples'");
    await console.close();
  });

  test("a result prints after #=>", async () => {
    const console = await session();

    expect(await console.send("1 + 1")).toBe("#=> 2");
    await console.close();
  });

  test("await works at the top level, and a record prints as it does in a log", async () => {
    const console = await session();

    expect(await console.send("await db.model(Sample).find(1)")).toBe(
      "#=> Sample { id: 1, label: 'bolt', quantity: 36 }",
    );
    await console.close();
  });

  test("a const lives on across lines", async () => {
    const console = await session();

    await console.send("const sample = await db.model(Sample).find(1)");
    expect(await console.send("sample.label")).toBe("#=> 'bolt'");
    await console.close();
  });

  test("an error prints its message, not as a result", async () => {
    const console = await session();

    const failure = await console.send("await db.model(Sample).find(99)");

    expect(failure).toMatch(/RecordNotFound/);
    expect(failure).not.toContain("#=>");
    await console.close();
  });

  test("the session carries on after an error", async () => {
    const console = await session();

    await console.send("await db.model(Sample).find(99)");

    expect(await console.send("1 + 1")).toBe("#=> 2");
    await console.close();
  });

  test("a Model's statics need no database argument", async () => {
    const console = await session();

    expect(await console.send("await Sample.find(1)")).toBe(
      "#=> Sample { id: 1, label: 'bolt', quantity: 36 }",
    );
    await console.close();
  });

  test("a record's writes need no database argument", async () => {
    const console = await session();

    await console.send("const sample = await Sample.find(1)");
    expect(await console.send('await sample.update({ label: "nut" })')).toBe("#=> true");
    expect(await binding.prepare("SELECT label FROM samples WHERE id = 1").first("label")).toBe(
      "nut",
    );
    await console.close();
  });

  test("piped input runs in order, and the session outlasts the end of its input", async () => {
    const terminal = terminalStreams();
    const session = startSession({
      input: terminal.input,
      output: terminal.output,
      scope: { Sample, db: connect(binding) },
      withDatabase: (run) => withDatabase(connect(binding), run),
    });
    await terminal.ready();

    terminal.input.write("const sample = await Sample.find(1)\n");
    terminal.input.write("sample.label\n");
    terminal.input.write('await sample.update({ label: "nut" })\n');
    terminal.input.end();
    await session.closed;

    expect(terminal.transcript().match(/#=> .*/g)).toEqual([
      "#=> undefined",
      "#=> 'bolt'",
      "#=> true",
    ]);
    expect(await binding.prepare("SELECT label FROM samples WHERE id = 1").first("label")).toBe(
      "nut",
    );
  });

  test("a terminal gets colors in its results", async () => {
    const terminal = terminalStreams();
    const session = startSession({
      input: terminal.input,
      output: terminal.output,
      terminal: true,
      scope: { Sample },
      withDatabase: (run) => withDatabase(connect(binding), run),
    });
    terminal.input.write("1 + 1\n");
    await waitFor(() => terminal.transcript().includes("#=>"));
    terminal.input.end();
    await session.closed;

    expect(terminal.transcript()).toContain("#=> \u001b[33m2\u001b[39m");
  });

  describe.each(["quit", "exit"])("typing %s", { timeout: 30_000 }, (word) => {
    /** Types the lines; resolves once the console closes, so one that stays times the test out. */
    async function leaves(...lines: string[]): Promise<void> {
      const terminal = terminalStreams();
      const session = startSession({
        input: terminal.input,
        output: terminal.output,
        scope: { Sample, db: connect(binding) },
        withDatabase: (run) => withDatabase(connect(binding), run),
      });
      await terminal.ready();
      terminal.input.write(`${lines.join("\n")}\n`);
      await session.closed;
    }

    test("leaves the console", async () => {
      await leaves(word);
    });

    test("runs no line typed after it", async () => {
      await leaves(word, 'await Sample.create({ id: 2, label: "late" })');

      expect(await binding.prepare("SELECT COUNT(*) AS n FROM samples").first("n")).toBe(1);
    });
  });

  test("a line typed key by key runs: completion's own evaluations don't block it", async () => {
    const terminal = terminalStreams();
    const session = startSession({
      input: terminal.input,
      output: terminal.output,
      terminal: true,
      scope: { Sample },
      withDatabase: (run) => withDatabase(connect(binding), run),
    });
    // The REPL evaluates the receiver of what is being typed (`try { await Sample } catch {}`)
    // to offer completions: a person typing gives it the time to, a burst or a pipe does not.
    for (const key of "await Sample.find(1)") {
      terminal.input.write(key);
      // oxlint-disable-next-line d1-record/no-fixed-delay -- typing speed: completion runs between keys
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    terminal.input.write("\n");
    await waitFor(() => terminal.transcript().includes("#=>"), 5);
    terminal.input.end();

    expect(terminal.transcript()).toContain("label");
    await session.closed;
  });

  test("a command typed after quit does not run", async () => {
    const ran: string[] = [];
    const terminal = terminalStreams();
    const session = startSession({
      input: terminal.input,
      output: terminal.output,
      scope: {},
      commands: {
        ping: {
          help: "Does nothing",
          run: () => {
            ran.push("ping");
            return "pong";
          },
        },
      },
      withDatabase: (run) => withDatabase(connect(binding), run),
    });
    await terminal.ready();

    terminal.input.write("quit\n.ping\n");
    // oxlint-disable-next-line d1-record/no-fixed-delay -- a bound, in case quit never closes the session
    await Promise.race([session.closed, new Promise((resolve) => setTimeout(resolve, 2000))]);

    expect(ran).toEqual([]);
  });

  test("a line typed while an await is running runs against the database when it finishes", async () => {
    const terminal = terminalStreams();
    const session = startSession({
      input: terminal.input,
      output: terminal.output,
      terminal: true,
      scope: { Sample },
      withDatabase: (run) => withDatabase(connect(binding), run),
    });

    terminal.input.write("await new Promise((resolve) => setTimeout(resolve, 400))\n");
    // Typed once the first line is awaiting: the REPL holds it back, then runs it from inside
    // the first line's async context.
    // oxlint-disable-next-line d1-record/no-fixed-delay -- the console prints nothing while a line awaits
    await new Promise((resolve) => setTimeout(resolve, 100));
    terminal.input.write("await Sample.find(1)\n");
    await waitFor(() => /Sample \{|NoDatabase/.test(terminal.transcript()), 4);
    terminal.input.end();

    expect(terminal.transcript()).toContain("Sample {");
    expect(terminal.transcript()).not.toContain("NoDatabase");
    await session.closed;
  });
});
