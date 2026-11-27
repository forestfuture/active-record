// Runs this repo's Wrangler for the tests, as a developer runs it in their app's folder.
import { execFileSync } from "node:child_process";

const wrangler = new URL("../../node_modules/.bin/wrangler", import.meta.url).pathname;

/** Runs Wrangler in `cwd`, with `env` added to the environment; what it printed. */
export function runWrangler(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync(wrangler, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
}
