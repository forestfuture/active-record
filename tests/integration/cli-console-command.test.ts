import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, onTestFinished, test, vi } from "vite-plus/test";
import { openLocalBinding } from "../../packages/d1-record/cli/binding.ts";
import { runConsole } from "../../packages/active-record/cli/console/command.ts";
import { main } from "../../packages/active-record/cli/main.ts";
import { terminalStreams, waitFor } from "../support/console.ts";
import type { TestDatabase } from "../support/d1.ts";
import { scratchDirs } from "../support/scratch.ts";
import { chosen, shop as makeShop } from "../support/shop.ts";

const scratch = scratchDirs();
const shop = () => makeShop(scratch);

/** A running console on a project (with these options), and its folder for edits between lines. */
async function running(options: { verbose?: boolean } = {}) {
  const cwd = await shop();
  const terminal = terminalStreams();
  const done = runConsole({ cwd, ...options }, () => {}, terminal);
  await terminal.ready();
  const send = (line: string) => terminal.send(line);
  const end = () => {
    terminal.input.end();
    return done;
  };
  return { cwd, send, end };
}

describe("active-record console", () => {
  test("opens the project's local database with its Models, and persists what you do", async () => {
    const cwd = await shop();
    const terminal = terminalStreams();
    const lines: string[] = [];

    const done = runConsole({ cwd }, (line) => lines.push(line), terminal);
    await terminal.ready();

    expect(lines).toEqual(["Local database DB (.wrangler/state)", "Models: User"]);
    expect(await terminal.send("const user = await User.find(1)")).toBe("#=> undefined");
    expect(await terminal.send('await user.update({ name: "Johnny" })')).toBe("#=> true");
    expect(await terminal.send("user.name")).toBe("#=> 'Johnny'");
    terminal.input.end();
    expect(await done).toBe(0);

    const reopened = await openLocalBinding(cwd, chosen(cwd));
    if (typeof reopened === "string") throw new Error(reopened);
    const name = await (reopened.binding as TestDatabase)
      .prepare("SELECT name FROM users WHERE id = 1")
      .first("name");
    await reopened.dispose();
    expect(name).toBe("Johnny");
  }, 90_000);

  test("says why it can't start, and exits 1", async () => {
    const cwd = scratch("console-empty-");
    const lines: string[] = [];

    const code = await runConsole({ cwd }, (line) => lines.push(line), terminalStreams());

    expect(code).toBe(1);
    expect(lines).toEqual([
      "No wrangler.jsonc, wrangler.json or wrangler.toml here (pass --config)",
    ]);
  });

  test("is an active-record command with its own options in the help", async () => {
    const lines: string[] = [];

    expect(await main(["console", "--help"], (line) => lines.push(line))).toBe(0);
    expect(lines[0]).toMatch(/active-record console \(or c\) +Open a console/);
    expect(lines[0]).toMatch(/Options for console:\n  --database <name>/);
    expect(lines[0]).toMatch(/--no-history +Don't keep what you type/);
    expect(lines[0]).toMatch(/Options for every command:\n  --adapter <name>/);
  });

  test("c is the same command", async () => {
    const cwd = scratch("console-alias-");
    const inProject = vi.spyOn(process, "cwd").mockReturnValue(cwd);
    onTestFinished(() => inProject.mockRestore());
    const lines: string[] = [];

    expect(await main(["c"], (line) => lines.push(line))).toBe(1);
    expect(lines).toEqual([
      "No wrangler.jsonc, wrangler.json or wrangler.toml here (pass --config)",
    ]);
  });

  test("keeps the history beside the project's local state", async () => {
    const cwd = await shop();
    const terminal = terminalStreams();
    const done = runConsole({ cwd }, () => {}, { ...terminal, terminal: true });
    const history = join(cwd, ".wrangler/d1-record-history");

    terminal.input.write("1 + 1\n");
    await waitFor(() => existsSync(history));
    terminal.input.end();
    await done;

    expect(readFileSync(history, "utf8")).toContain("1 + 1");
  }, 90_000);

  test("--no-history keeps what you type out of the history file", async () => {
    const cwd = await shop();
    const terminal = terminalStreams();
    const done = runConsole({ cwd, history: false }, () => {}, { ...terminal, terminal: true });

    terminal.input.write("1 + 1\n");
    await waitFor(() => terminal.transcript().includes("#=>"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    terminal.input.end();
    await done;

    expect(existsSync(join(cwd, ".wrangler/d1-record-history"))).toBe(false);
  }, 90_000);

  // pgrep: not on Windows. SIGKILL can't be caught, and does leave workerd running.
  describe.skipIf(process.platform === "win32").each(["SIGTERM", "SIGHUP"] as const)(
    "when it is sent %s",
    (signal) => {
      /** The pids of a process's children (`workerd`, for the console), or none. */
      function childrenOf(pid: number): number[] {
        try {
          return execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
            .split("\n")
            .filter(Boolean)
            .map(Number);
        } catch {
          return [];
        }
      }
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };

      test("it stops the workerd it started, which would otherwise outlive it", async () => {
        const cwd = await shop();
        const bin = new URL("../../packages/active-record/cli/bin.ts", import.meta.url).pathname;
        const child = spawn(process.execPath, [bin, "console", "--no-history"], {
          cwd,
          stdio: ["pipe", "pipe", "inherit"],
        });
        let printed = "";
        child.stdout.on("data", (chunk: Buffer) => (printed += chunk.toString()));
        const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
        await waitFor(() => printed.includes("Models: User"), 60);
        const workers = childrenOf(child.pid!);

        child.kill(signal);
        await exited;
        await waitFor(() => workers.every((pid) => !alive(pid)), 10);
        const survivors = workers.filter(alive);
        for (const pid of survivors) process.kill(pid, "SIGKILL");

        expect(workers.length).toBeGreaterThan(0);
        expect(survivors).toEqual([]);
      }, 90_000);
    },
  );

  describe("reloading Models", () => {
    const edited = `
      import { ApplicationRecord } from "./application-record";
      export class User extends ApplicationRecord { static edited = "yes"; }
    `;

    /** A console line that writes `started`, then waits until `model` holds the edit. */
    const waitsForEdit = (model: string, started: string) => {
      const fs = 'require("node:fs")';
      const hasEdit = `${fs}.readFileSync(${JSON.stringify(model)}, "utf8").includes("edited")`;
      const wait = "await new Promise((resolve) => setTimeout(resolve, 10))";
      return `${fs}.writeFileSync(${JSON.stringify(started)}, ""); while (!${hasEdit}) ${wait}`;
    };

    test("reload! says which Models it loaded", async () => {
      const { cwd, send, end } = await running();
      writeFileSync(join(cwd, "src/models/user.ts"), edited);

      expect(await send("reload!")).toBe("Reloaded: User");
      await end();
    }, 90_000);

    test("reload! picks up an edit to a Model", async () => {
      const { cwd, send, end } = await running();
      expect(await send("User.edited")).toBe("#=> undefined");
      writeFileSync(join(cwd, "src/models/user.ts"), edited);
      await send("reload!");

      expect(await send("User.edited")).toBe("#=> 'yes'");
      await end();
    }, 90_000);

    test(".reload picks up an edit to a Model", async () => {
      const { cwd, send, end } = await running();
      writeFileSync(join(cwd, "src/models/user.ts"), edited);

      expect(await send(".reload")).toBe("Reloaded: User");
      expect(await send("User.edited")).toBe("#=> 'yes'");
      await end();
    }, 90_000);

    test(".reload is listed in .help", async () => {
      const { send, end } = await running();

      expect(await send(".help")).toMatch(/\.reload +Read your Models again/);
      await end();
    }, 90_000);

    test("the database still works for the reloaded Models", async () => {
      const { cwd, send, end } = await running();
      writeFileSync(join(cwd, "src/models/user.ts"), edited);
      await send("reload!");

      expect(await send("(await User.find(1)).name")).toBe("#=> 'Alice'");
      await end();
    }, 90_000);

    test("a Model file that throws is named, with its message", async () => {
      const { cwd, send, end } = await running();
      writeFileSync(join(cwd, "src/models/user.ts"), 'throw new Error("mid-edit");');

      expect(await send("reload!")).toBe("Couldn't load src/models/user.ts: mid-edit");
      await end();
    }, 90_000);

    test("after a reload that fails, the Models are as they were", async () => {
      const { cwd, send, end } = await running();
      writeFileSync(join(cwd, "src/models/user.ts"), 'throw new Error("mid-edit");');
      await send("reload!");

      expect(await send("(await User.find(1)).name")).toBe("#=> 'Alice'");
      await end();
    }, 90_000);

    test("reload! waits for a line that is still running", async () => {
      const cwd = await shop();
      const terminal = terminalStreams();
      const done = runConsole({ cwd }, () => {}, terminal);
      await terminal.ready();

      // All typed at once, as pasted. The edit lands while the first line is still running, so a
      // reload that ran straight away would not see it.
      const model = join(cwd, "src/models/user.ts");
      const started = join(cwd, "started");
      terminal.input.write(`${waitsForEdit(model, started)}\n`);
      terminal.input.write("reload!\nUser.edited\n");
      terminal.input.end();
      await waitFor(() => existsSync(started), 60);
      // The first line waits for the edit however late it lands; this gives a reload that didn't
      // wait the time to run first and show it.
      await new Promise((resolve) => setTimeout(resolve, 150));
      writeFileSync(model, edited);
      await done;

      expect(terminal.transcript()).toContain("#=> 'yes'");
    }, 90_000);

    test("a record you already hold keeps its old class", async () => {
      const { cwd, send, end } = await running();
      await send("const user = await User.find(1)");
      writeFileSync(join(cwd, "src/models/user.ts"), edited);
      await send("reload!");

      expect(await send("user instanceof User")).toBe("#=> false");
      await end();
    }, 90_000);
  });

  describe("showing the SQL", () => {
    test("--verbose prints each statement before the result, with its Model and time", async () => {
      const { send, end } = await running({ verbose: true });

      const printed = await send("await User.find(1)");

      expect(printed).toMatch(
        /^User +\d+\.\dms +SELECT \* FROM "users" WHERE .*\[ 1, 1 \]\n#=> User \{/,
      );
      await end();
    }, 90_000);

    test("without --verbose, a result has no statement line before it", async () => {
      const { send, end } = await running();

      expect(await send("await User.find(1)")).toMatch(/^#=> User \{/);
      await end();
    }, 90_000);

    test("a filtered value shows as [FILTERED], as in onQuery", async () => {
      const { send, end } = await running({ verbose: true });

      const printed = await send('await User.where({ email: "alice@example.com" }).toArray()');

      expect(printed).toMatch(/^User +\d+\.\dms +SELECT .*\[ '\[FILTERED\]' \]\n/);
      expect(printed).not.toContain("alice@example.com");
      await end();
    }, 90_000);

    test("a statement that fails says so, with D1's reason", async () => {
      const { send, end } = await running({ verbose: true });

      const printed = await send(
        'await User.create({ id: 1, name: "Dup", email: "d@example.com" })',
      );

      expect(printed).toMatch(/^User +failed +INSERT INTO "users"/);
      await end();
    }, 90_000);

    test(".verbose turns it on and off while the console runs", async () => {
      const { send, end } = await running();

      expect(await send(".verbose")).toBe("SQL logging on");
      expect(await send("await User.find(1)")).toMatch(/^User /);
      expect(await send(".verbose off")).toBe("SQL logging off");
      expect(await send("await User.find(1)")).toMatch(/^#=> User \{/);
      expect(await send(".verbose on")).toBe("SQL logging on");
      await end();
    }, 90_000);

    test(".verbose on stays on when it is already on", async () => {
      const { send, end } = await running({ verbose: true });

      expect(await send(".verbose on")).toBe("SQL logging on");
      expect(await send("await User.find(1)")).toMatch(/^User /);
      await end();
    }, 90_000);

    test(".verbose off stays off when it is already off", async () => {
      const { send, end } = await running();

      expect(await send(".verbose off")).toBe("SQL logging off");
      expect(await send("await User.find(1)")).toMatch(/^#=> User \{/);
      await end();
    }, 90_000);

    test(".verbose with an argument it doesn't know says so and changes nothing", async () => {
      const { send, end } = await running({ verbose: true });

      expect(await send(".verbose banana")).toBe("Use .verbose, .verbose on, or .verbose off");
      expect(await send("await User.find(1)")).toMatch(/^User /);
      await end();
    }, 90_000);

    test("verbose! toggles it as a bare line", async () => {
      const { send, end } = await running();

      expect(await send("verbose!")).toBe("SQL logging on");
      expect(await send("await User.find(1)")).toMatch(/^User /);
      expect(await send("verbose!")).toBe("SQL logging off");
      await end();
    }, 90_000);

    test("verbose!; with a semicolon is the same line", async () => {
      const { send, end } = await running();

      expect(await send("verbose!;")).toBe("SQL logging on");
      await end();
    }, 90_000);

    test(".verbose is in .help", async () => {
      const { send, end } = await running();

      expect(await send(".help")).toMatch(/\.verbose +Show the SQL/);
      await end();
    }, 90_000);
  });
});
