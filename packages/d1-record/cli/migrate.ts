// `active-record migrate` on D1: the project's own Wrangler applies the database's migrations, locally or remotely.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import type { ChosenDatabase, MigrateIo } from "@forestfuture/active-record/cli";

/** The project's own Wrangler's command line script, or why there's none. */
function wranglerBin(cwd: string): string | string[] {
  try {
    const manifest = fileURLToPath(createJiti(`${cwd}/`).esmResolve("wrangler/package.json"));
    return join(dirname(manifest), "bin", "wrangler.js");
  } catch {
    return ["wrangler isn't installed here (install it, then run active-record migrate again)"];
  }
}

/**
 * Runs `wrangler d1 migrations apply <binding>`, `--local` or `--remote`, with the project's
 * config, as a person would. What Wrangler prints goes to `io`; it resolves to Wrangler's exit code.
 */
export function migrate(
  cwd: string,
  { binding, configFile }: ChosenDatabase,
  { remote }: { remote: boolean },
  io: MigrateIo,
): Promise<number> {
  const bin = wranglerBin(cwd);
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
