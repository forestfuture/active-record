import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { runConsole, standardIo } from "../../packages/active-record/cli/console/command.ts";
import { main } from "../../packages/active-record/cli/main.ts";
import { capturedStreams, terminalStreams, waitFor } from "../support/console.ts";
import { scratchDirs } from "../support/scratch.ts";
import { remoteProject } from "../support/shop.ts";

const scratch = scratchDirs();

const remoteShop = (entry?: Record<string, unknown>) => remoteProject(scratch, entry);

/** A console on a terminal that has been asked for its first line, with what it printed. */
function onATerminal() {
  const terminal = terminalStreams();
  const lines: string[] = [];
  return { terminal, lines, io: { ...terminal, terminal: true } };
}

// `active-record console --remote` (#104): the same console on the real database, after asking.
describe("active-record console --remote", () => {
  test("--yes opens it through wrangler's remote proxy", async () => {
    const { cwd, asked } = await remoteShop();
    const terminal = terminalStreams();

    const done = runConsole({ cwd, remote: true, yes: true }, () => {}, terminal);
    await terminal.ready();

    expect(asked()).toEqual([{ remoteBindings: true, persist: false }]);
    expect(await terminal.send("(await User.find(1)).name")).toBe("#=> 'Alice'");
    terminal.input.end();
    expect(await done).toBe(0);
  }, 90_000);

  test("says which database it opened", async () => {
    const { cwd } = await remoteShop();
    const terminal = terminalStreams();
    const lines: string[] = [];

    const done = runConsole({ cwd, remote: true, yes: true }, (line) => lines.push(line), terminal);
    await terminal.ready();
    terminal.input.end();
    await done;

    expect(lines).toEqual(["Remote database DB (shop, id local-shop)", "Models: User"]);
  }, 90_000);

  test("marks its prompt remote", async () => {
    const { cwd } = await remoteShop();
    const terminal = terminalStreams();
    const done = runConsole({ cwd, remote: true, yes: true }, () => {}, terminal);
    await terminal.ready();

    await terminal.send("1 + 1");

    expect(terminal.transcript()).toContain("\nremote> ");
    terminal.input.end();
    await done;
  }, 90_000);

  test("is refused off a terminal without --yes, before wrangler is asked for anything", async () => {
    const { cwd, asked } = await remoteShop();
    const lines: string[] = [];

    const code = await runConsole(
      { cwd, remote: true },
      (line) => lines.push(line),
      terminalStreams(),
    );

    expect(code).toBe(1);
    expect(lines).toEqual([
      "Opening a remote database asks you to confirm it: run this on a terminal, or add --yes",
    ]);
    expect(asked()).toEqual([]);
  }, 90_000);

  test("on a terminal, opens once the database's name is typed", async () => {
    const { cwd, asked } = await remoteShop();
    const { terminal, lines, io } = onATerminal();

    const done = runConsole({ cwd, remote: true }, (line) => lines.push(line), io);
    await waitFor(() => terminal.transcript().includes("Type its name to continue"));
    expect(asked()).toEqual([]);
    terminal.input.write("shop\n");
    await waitFor(() => lines.includes("Models: User"));
    terminal.input.write("quit\n");

    expect(await done).toBe(0);
    expect(asked()).toHaveLength(1);
    expect(lines[0]).toBe("Remote database DB (shop, id local-shop)");
  }, 90_000);

  test("on a terminal, what is typed behind the name is dropped, not run", async () => {
    const { cwd } = await remoteShop();
    const { terminal, lines, io } = onATerminal();

    const done = runConsole({ cwd, remote: true }, (line) => lines.push(line), io);
    await waitFor(() => terminal.transcript().includes("Type its name to continue"));
    terminal.input.write("shop\n");
    // A terminal delivers a paste a line at a time, while the connection is still being made.
    await new Promise((resolve) => setTimeout(resolve, 10));
    terminal.input.write('await User.create({ id: 2, name: "pasted", email: "p@example.com" })\n');
    await waitFor(() => terminal.transcript().includes("remote> "));
    terminal.input.write("await User.count()\n");
    await waitFor(() => terminal.transcript().includes("#=>"), 20);
    terminal.input.write("quit\n");

    expect(await done).toBe(0);
    expect(terminal.transcript()).toContain("#=> \u001b[33m1\u001b[39m");
  }, 90_000);

  test("on a terminal, isn't opened by any other answer", async () => {
    const { cwd, asked } = await remoteShop();
    const { terminal, lines, io } = onATerminal();

    const done = runConsole({ cwd, remote: true }, (line) => lines.push(line), io);
    await waitFor(() => terminal.transcript().includes("Type its name to continue"));
    terminal.input.write("y\n");

    expect(await done).toBe(1);
    expect(lines).toEqual(["Not opened."]);
    expect(asked()).toEqual([]);
  }, 90_000);

  test("is refused when the config gives no database id", async () => {
    const { cwd, asked } = await remoteShop({ binding: "DB", database_name: "shop" });
    const lines: string[] = [];

    const code = await runConsole(
      { cwd, remote: true, yes: true },
      (line) => lines.push(line),
      terminalStreams(),
    );

    expect(code).toBe(1);
    expect(lines).toEqual(["DB has no database_id in wrangler.jsonc, which --remote needs"]);
    expect(asked()).toEqual([]);
  }, 90_000);

  test("keeps no history of what you type", async () => {
    const { cwd } = await remoteShop();
    const { terminal, lines, io } = onATerminal();
    const done = runConsole({ cwd, remote: true, yes: true }, (line) => lines.push(line), io);

    await waitFor(() => lines.includes("Models: User"));
    terminal.input.write("1 + 1\n");
    await waitFor(() => terminal.transcript().includes("#=>"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    terminal.input.end();
    await done;

    expect(existsSync(join(cwd, ".wrangler/d1-record-history"))).toBe(false);
  }, 90_000);

  test("keeps what you type, in a file of its own, when asked to", async () => {
    const { cwd } = await remoteShop();
    const { terminal, lines, io } = onATerminal();
    const done = runConsole(
      { cwd, remote: true, yes: true, history: true },
      (line) => lines.push(line),
      io,
    );
    const history = join(cwd, ".wrangler/d1-record-history-remote");

    await waitFor(() => lines.includes("Models: User"));
    terminal.input.write("1 + 1\n");
    await waitFor(() => existsSync(history));
    terminal.input.end();
    await done;

    expect(readFileSync(history, "utf8")).toContain("1 + 1");
    expect(existsSync(join(cwd, ".wrangler/d1-record-history"))).toBe(false);
  }, 90_000);
});

describe("the local console's prompt", () => {
  test("says local", async () => {
    const { cwd } = await remoteShop();
    const terminal = terminalStreams();
    const done = runConsole({ cwd }, () => {}, terminal);
    await terminal.ready();
    await terminal.send("1 + 1");

    expect(terminal.transcript()).toContain("\nlocal> ");
    terminal.input.end();
    await done;
  }, 90_000);
});

// `-e` with `--remote` (#105): the same consent as a session, with the result alone on stdout.
describe("active-record console -e --remote", () => {
  /** A script's streams, with a terminal flag for the confirmation. */
  function streams(terminal: boolean) {
    const { input, output, error, seen } = capturedStreams();
    return { io: { input, output, error, terminal }, seen };
  }

  test("is refused without --yes when stdout is not a terminal, as $(…) makes it", async () => {
    const { cwd, asked } = await remoteShop();
    const { io, seen } = streams(false);

    const code = await runConsole({ cwd, remote: true, eval: "1 + 1" }, () => {}, io);

    expect(code).toBe(1);
    expect(seen.stdout).toBe("");
    expect(seen.stderr).toBe(
      "Opening a remote database asks you to confirm it: run this on a terminal, or add --yes\n",
    );
    expect(asked()).toEqual([]);
  }, 90_000);

  test("with --yes prints the result alone on stdout, and names the database on stderr", async () => {
    const { cwd, asked } = await remoteShop();
    const { io, seen } = streams(false);

    const code = await runConsole(
      { cwd, remote: true, yes: true, eval: "(await User.find(1)).name" },
      () => {},
      io,
    );

    expect(code).toBe(0);
    expect(seen.stdout).toBe("Alice\n");
    expect(seen.stderr).toBe("Remote database DB (shop, id local-shop)\nModels: User\n");
    expect(asked()).toEqual([{ remoteBindings: true, persist: false }]);
  }, 90_000);

  test("fails, with no result, when the proxy won't stop", async () => {
    const { cwd } = await remoteShop();
    writeFileSync(join(cwd, "wont-stop"), "");
    const { io, seen } = streams(false);

    const code = await runConsole(
      { cwd, remote: true, yes: true, eval: "(await User.find(1)).name" },
      () => {},
      io,
    );

    expect(code).toBe(1);
    expect(seen.stdout).toBe("");
    expect(seen.stderr).toContain("proxy would not stop");
  }, 90_000);

  test("on a terminal asks where the person is looking, then prints the result", async () => {
    const { cwd } = await remoteShop();
    const { io, seen } = streams(true);

    const running = runConsole(
      { cwd, remote: true, eval: "(await User.find(1)).name" },
      () => {},
      io,
    );
    await waitFor(() => seen.stdout.includes("Type its name to continue"));
    io.input.write("shop\n");

    expect(await running).toBe(0);
    expect(seen.stdout).toMatch(/Type its name to continue, anything else cancels: Alice\n$/);
    expect(seen.stderr).not.toContain("Type its name");
  }, 90_000);
});

describe("what counts as a terminal", () => {
  /** `standardIo` with the process's stdin and stdout each a terminal or not. */
  function ioWhen(stdin: boolean, stdout: boolean) {
    const was = {
      stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
      stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
    };
    Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true });
    try {
      return standardIo().terminal;
    } finally {
      for (const [stream, key] of [
        [process.stdin, "stdin"],
        [process.stdout, "stdout"],
      ] as const) {
        if (was[key] === undefined) delete (stream as { isTTY?: boolean }).isTTY;
        else Object.defineProperty(stream, "isTTY", was[key]);
      }
    }
  }

  test("is both: a person at the keyboard and a screen", () => {
    expect(ioWhen(true, true)).toBe(true);
  });

  test("is not a terminal when stdin is piped, so a pipe can't answer for a person", () => {
    expect(ioWhen(false, true)).toBe(false);
  });

  test("is not a terminal when stdout is piped", () => {
    expect(ioWhen(true, false)).toBe(false);
  });
});

describe("--remote on the command line", () => {
  test("is in the help, with --yes and --history", async () => {
    const lines: string[] = [];

    await main(["console", "--help"], (line) => lines.push(line));

    expect(lines[0]).toMatch(/--remote +Open your remote database/);
    expect(lines[0]).toMatch(/--yes +Don't ask first/);
    expect(lines[0]).toMatch(/--history +Keep what you type/);
  });

  test("--yes without --remote is a mistake, since it would skip nothing", async () => {
    const lines: string[] = [];

    expect(await main(["console", "--yes"], (line) => lines.push(line))).toBe(1);
    expect(lines[0]).toMatch(/^--yes only goes with --remote/);
  });

  test("--history and --no-history together are a mistake", async () => {
    const lines: string[] = [];

    expect(await main(["console", "--history", "--no-history"], (line) => lines.push(line))).toBe(
      1,
    );
    expect(lines[0]).toMatch(/^Use --history or --no-history, not both/);
  });
});
