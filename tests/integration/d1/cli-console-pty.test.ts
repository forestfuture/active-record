import { describe, expect, test } from "vite-plus/test";
import { inPty, ptyAvailable } from "../../support/pty.ts";
import { remoteProject, shop } from "../../support/shop.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();
const cli = new URL("../../../packages/active-record/cli/bin.ts", import.meta.url).pathname;
const yellow = (text: string) => `\u001b[33m${text}\u001b[39m`;

// What a terminal does that a piped stream can't show: line editing, completion while typing, a
// paste arriving a line at a time, Ctrl-D, colors. See docs/agents/workflow.md, step 3.
describe.skipIf(!ptyAvailable)("active-record console on a terminal", () => {
  test("shows a local> prompt", async () => {
    const cwd = await shop(scratch);

    const run = await inPty({
      cwd,
      argv: ["node", cli, "console"],
      steps: [{ expect: "local> " }, { send: "\u0004" }, { exit: 20 }],
    });

    expect(run.failed).toBeNull();
    expect(run.transcript).toContain("local> ");
  }, 90_000);

  test("runs a line typed key by key, though completion evaluates as it goes", async () => {
    const cwd = await shop(scratch);

    const run = await inPty({
      cwd,
      argv: ["node", cli, "console"],
      steps: [
        { expect: "local> " },
        { send: "await User.count()\r", typing: 0.03 },
        { expect: `#=> ${yellow("1")}` },
        { send: "\u0004" },
        { exit: 20 },
      ],
    });

    expect(run.failed).toBeNull();
  }, 90_000);

  test("leaves on Ctrl-D with exit code 0", async () => {
    const cwd = await shop(scratch);

    const run = await inPty({
      cwd,
      argv: ["node", cli, "console"],
      steps: [{ expect: "local> " }, { send: "\u0004" }, { exit: 20 }],
    });

    expect(run.exitCode).toBe(0);
  }, 90_000);

  test("colors a result", async () => {
    const cwd = await shop(scratch);

    const run = await inPty({
      cwd,
      argv: ["node", cli, "console"],
      steps: [
        { expect: "local> " },
        { send: "1 + 1\r" },
        { expect: `#=> ${yellow("2")}` },
        { send: "\u0004" },
        { exit: 20 },
      ],
    });

    expect(run.failed).toBeNull();
  }, 90_000);

  test("drops lines pasted behind the remote database's name", async () => {
    const { cwd } = await remoteProject(scratch);

    const run = await inPty({
      cwd,
      argv: ["node", cli, "console", "--remote"],
      steps: [
        { expect: "Type its name to continue" },
        // The name and a write, as a paste: the terminal hands them over a line at a time.
        { send: 'shop\rawait User.create({ id: 2, name: "pasted", email: "p@example.com" })\r' },
        { expect: "remote> " },
        { wait: 1 },
        { send: "await User.count()\r" },
        { expect: `#=> ${yellow("1")}` },
        { send: "\u0004" },
        { exit: 20 },
      ],
    });

    expect(run.failed).toBeNull();
  }, 90_000);
});
