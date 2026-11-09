// A Worker app in a folder of its own, driven as its developer does: the active-record command run in it, its Worker bundled by Wrangler and served by Miniflare.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare, supportedCompatibilityDate, type MiniflareOptions } from "miniflare";
import { onTestFinished, vi } from "vite-plus/test";
import { main } from "../../packages/active-record/cli/main.ts";
import { parseJsonc } from "../../packages/active-record/cli/project/config-file.ts";

const wrangler = new URL("../../node_modules/.bin/wrangler", import.meta.url).pathname;

/** Runs `active-record` with `argv` in `cwd`, as from a terminal there: its exit code and output. */
export async function command(
  cwd: string,
  argv: string[],
): Promise<{ code: unknown; out: string }> {
  const lines: string[] = [];
  const inProject = vi.spyOn(process, "cwd").mockReturnValue(cwd);
  onTestFinished(() => inProject.mockRestore());
  const code = await main(argv, (line) => lines.push(line));
  return { code, out: lines.join("\n") };
}

/** Runs Wrangler in `cwd`, with `env` added to the environment; what it printed. */
export function runWrangler(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync(wrangler, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
}

export interface Served {
  fetch(method: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  dispose(): Promise<void>;
}

/**
 * The compatibility settings the app's Wrangler config gives its Worker, its date no later than
 * this Miniflare's workerd supports.
 */
function compatibility(
  cwd: string,
): Pick<MiniflareOptions, "compatibilityDate" | "compatibilityFlags"> {
  const config = parseJsonc(readFileSync(join(cwd, "wrangler.jsonc"), "utf8")) as {
    compatibility_date: string;
    compatibility_flags?: string[];
  };
  const date = [config.compatibility_date, supportedCompatibilityDate].sort()[0];
  return { compatibilityDate: date, compatibilityFlags: config.compatibility_flags ?? [] };
}

/**
 * The app's Worker as `wrangler deploy` would bundle it now, with the compatibility settings its
 * Wrangler config gives it, served by Miniflare with these bindings.
 */
export async function serve(
  cwd: string,
  options: {
    d1Databases?: Record<string, string>;
    d1Persist?: string;
    hyperdrives?: Record<string, string>;
  },
): Promise<Served> {
  const out = join(cwd, ".bundle");
  runWrangler(cwd, ["deploy", "--dry-run", "--outdir", out]);
  const mf = new Miniflare({
    modules: true,
    scriptPath: join(out, "index.js"),
    ...compatibility(cwd),
    ...options,
  } as MiniflareOptions);
  return {
    async fetch(method, body) {
      const init = body === undefined ? { method } : { method, body: JSON.stringify(body) };
      const response = await mf.dispatchFetch("https://example.com/", init);
      return { status: response.status, body: await response.json() };
    },
    dispose: () => mf.dispose(),
  };
}
