// A Worker app in a folder of its own, driven as its developer does: the arbor command run in it, its Worker bundled by Wrangler and served by Miniflare.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { onTestFinished, vi } from "vite-plus/test";
import { main } from "../../packages/arbor/cli/main.ts";
import { parseJsonc } from "../../packages/arbor/cli/project/config-file.ts";
import { startMiniflare, type TestWorker } from "./miniflare.ts";

const wrangler = new URL("../../node_modules/.bin/wrangler", import.meta.url).pathname;

/** Runs `arbor` with `argv` in `cwd`, as from a terminal there: its exit code and output. */
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

/** What Miniflare needs of the app's Wrangler config to run its Worker as Wrangler would. */
interface WranglerConfig {
  compatibility_date: string;
  compatibility_flags?: string[];
  d1_databases?: { binding: string; database_id: string }[];
  hyperdrive?: { binding: string; localConnectionString: string }[];
}

/**
 * The app's Worker, from its Wrangler config: its compatibility settings, and its D1 and
 * Hyperdrive bindings, each D1 database kept in Wrangler's local state and each Hyperdrive
 * reaching its local URL.
 */
function fromConfig(cwd: string): TestWorker {
  const config = parseJsonc(readFileSync(join(cwd, "wrangler.jsonc"), "utf8")) as WranglerConfig;
  const d1 = config.d1_databases ?? [];
  const hyperdrive = config.hyperdrive ?? [];
  return {
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags ?? [],
    d1: Object.fromEntries(d1.map((entry) => [entry.binding, entry.database_id])),
    persistTo: join(cwd, ".wrangler/state/v3"),
    hyperdrives: Object.fromEntries(
      hyperdrive.map((entry) => [entry.binding, entry.localConnectionString]),
    ),
  };
}

/**
 * The app's Worker as `wrangler deploy` would bundle it now, served by Miniflare with the
 * settings and bindings its Wrangler config gives it, as `wrangler dev` would serve it.
 */
export async function serve(cwd: string): Promise<Served> {
  const out = join(cwd, ".bundle");
  runWrangler(cwd, ["deploy", "--dry-run", "--outdir", out]);
  const mf = startMiniflare({ main: join(out, "index.js"), ...fromConfig(cwd) });
  return {
    async fetch(method, body) {
      const init = body === undefined ? { method } : { method, body: JSON.stringify(body) };
      const response = await mf.dispatchFetch("https://example.com/", init);
      return { status: response.status, body: await response.json() };
    },
    dispose: () => mf.dispose(),
  };
}
