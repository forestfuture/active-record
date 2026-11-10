// `active-record migrate` on D1: the project's own Wrangler applies the database's migrations, locally or remotely.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWrangler } from "./installed-wrangler.ts";
import type { ChosenDatabase, MigrateOutput } from "@forestfuture/active-record/cli";

/** The project's own Wrangler's command line script (the Worker's, beside its config, first), or why there's none. */
function wranglerBin(cwd: string, configFile: string): string | string[] {
  const manifest = resolveWrangler(cwd, configFile, "wrangler/package.json");
  if (manifest === undefined) {
    return ["wrangler isn't installed here (install it, then run active-record migrate again)"];
  }
  return join(dirname(fileURLToPath(manifest)), "bin", "wrangler.js");
}

/**
 * Runs `wrangler d1 migrations apply <binding>`, `--local` or `--remote`, with the project's
 * config, as a person would. What Wrangler prints goes to `io`; it resolves to Wrangler's exit code.
 */
export function migrate(
  cwd: string,
  { binding, configFile }: ChosenDatabase,
  { remote }: { remote: boolean },
  io: MigrateOutput,
): Promise<number> {
  const bin = wranglerBin(cwd, configFile);
  if (Array.isArray(bin)) {
    io.output(`${bin[0]}\n`);
    return Promise.resolve(1);
  }
  const where = remote ? "--remote" : "--local";
  const args = [bin, "d1", "migrations", "apply", binding, where, "--config", configFile];
  const child = spawn(process.execPath, args, {
    cwd: dirname(configFile),
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => io.output(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => io.output(chunk.toString()));
  return new Promise((resolve) => {
    child.on("error", (error) => {
      io.output(`Couldn't run wrangler: ${error.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}
