import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { runConsole } from "../../packages/active-record/cli/console/command.ts";
import { main } from "../../packages/active-record/cli/main.ts";
import { capturedStreams } from "../support/console.ts";
import { scratchDirs } from "../support/scratch.ts";
import { shop } from "../support/shop.ts";

const scratch = scratchDirs();

/** What `console -e` printed on each stream, and its exit code. */
async function evaluating(code: string, options: { verbose?: boolean; cwd?: string } = {}) {
  const cwd = options.cwd ?? (await shop(scratch));
  const { input, output, error, seen } = capturedStreams();
  const said: string[] = [];

  const exitCode = await runConsole(
    { cwd, eval: code, verbose: options.verbose },
    (line) => said.push(line),
    { input, output, error },
  );
  return { cwd, exitCode, ...seen, said };
}

/** `main` run in a project of its own, with what it wrote to stdout. */
async function mainInShop(...args: string[]) {
  const cwd = await shop(scratch);
  const inProject = vi.spyOn(process, "cwd").mockReturnValue(cwd);
  const written: string[] = [];
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  try {
    const code = await main(args, () => {});
    return { code, stdout: written.join("") };
  } finally {
    inProject.mockRestore();
    out.mockRestore();
  }
}

// `active-record console -e` (#105): one piece of code, its result on stdout, everything else on stderr.
describe("active-record console -e", () => {
  test("prints the result on stdout, and nothing else there", async () => {
    const run = await evaluating("(await User.find(1)).name");

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("Alice\n");
    expect(run.said).toEqual([]);
  }, 90_000);

  test("says which database and Models it opened on stderr", async () => {
    const run = await evaluating("1 + 1");

    expect(run.stderr).toBe("Local database DB (.wrangler/state)\nModels: User\n");
  }, 90_000);

  test("a failure prints its stack on stderr, nothing on stdout, and exits 1", async () => {
    const run = await evaluating("await User.find(99)");

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/RecordNotFound/);
  }, 90_000);

  test("its writes persist, since it is the same database the console opens", async () => {
    const first = await evaluating(
      'await User.create({ id: 2, name: "Bob", email: "b@example.com" })',
    );
    const second = await evaluating("await User.count()", { cwd: first.cwd });

    expect(first.exitCode).toBe(0);
    expect(second.stdout).toBe("2\n");
  }, 120_000);

  test("prints each statement's SQL on stderr with --verbose, not on stdout", async () => {
    const run = await evaluating("(await User.find(1)).name", { verbose: true });

    expect(run.stdout).toBe("Alice\n");
    expect(run.stderr).toMatch(/User +\d+(\.\d+)?ms +SELECT /);
  }, 90_000);

  test("says why it can't start on stderr, and exits 1", async () => {
    const run = await evaluating("1 + 1", { cwd: scratch("console-eval-empty-") });

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe(
      "No wrangler.jsonc, wrangler.json or wrangler.toml here (pass --config)\n",
    );
  });

  test("keeps no history", async () => {
    const run = await evaluating("1 + 1");

    expect(existsSync(join(run.cwd, ".wrangler/active-record-history"))).toBe(false);
  }, 90_000);
});

describe("-e on the command line", () => {
  test("is a active-record console option, in the help", async () => {
    const lines: string[] = [];

    await main(["console", "--help"], (line) => lines.push(line));

    expect(lines[0]).toMatch(/-e, --eval <code> +Run this code/);
  });

  test("runs the code, and prints the result", async () => {
    const run = await mainInShop("console", "-e", "(await User.find(1)).email");

    expect(run).toEqual({ code: 0, stdout: "alice@example.com\n" });
  }, 90_000);

  test("--eval is the long form of -e", async () => {
    const run = await mainInShop("console", "--eval", "1 + 1");

    expect(run).toEqual({ code: 0, stdout: "2\n" });
  }, 90_000);

  test("once only: join statements with a semicolon", async () => {
    const lines: string[] = [];

    expect(await main(["console", "-e", "1", "-e", "2"], (line) => lines.push(line))).toBe(1);
    expect(lines[0]).toMatch(/^Use -e once; join statements with ;/);
  });

  test("needs some code", async () => {
    const lines: string[] = [];

    expect(await main(["console", "-e", ""], (line) => lines.push(line))).toBe(1);
    expect(lines[0]).toMatch(/^-e needs some code/);
  });
});
