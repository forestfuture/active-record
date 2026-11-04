// The console's D1 binding: the project's database, local or remote, opened through its own Wrangler (#104).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createJiti } from "jiti";
import { remoteDescription, remoteTarget, type ChosenDatabase } from "./database.ts";

/** An open binding, what to tell the person about it, and how to close it. */
export interface OpenBinding {
  /** The `D1Database` binding, as a Worker would have it as `env.DB`. */
  binding: unknown;
  description: string;
  dispose: () => Promise<void>;
}

interface Wrangler {
  getPlatformProxy: (options: {
    configPath: string;
    persist: { path: string } | false;
    remoteBindings: boolean;
  }) => Promise<{ env: Record<string, unknown>; dispose: () => Promise<void> }>;
}

/**
 * A Wrangler config holding only this D1 binding, in a folder of its own. `getPlatformProxy`
 * starts every binding a config declares, so the project's own config would bring its Durable
 * Objects, services and secrets (with their warnings, or failures) into a console that only
 * needs the database. The entry is the project's, verbatim, so Wrangler names the same local D1;
 * the `account_id` is carried so a remote proxy signs in to the project's account.
 */
function d1OnlyConfig(
  entry: Record<string, unknown>,
  accountId: string | undefined,
): { file: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "d1-record-console-"));
  const file = join(dir, "wrangler.jsonc");
  const config = { name: "d1-record-console", account_id: accountId, d1_databases: [entry] };
  writeFileSync(file, JSON.stringify(config));
  return { file, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The project's own wrangler, loaded; or why it can't be. */
async function projectWrangler(cwd: string): Promise<Wrangler | string> {
  let file: string;
  try {
    file = createJiti(`${cwd}/`).esmResolve("wrangler");
  } catch {
    return "wrangler isn't installed here (install it, then run d1-record console again)";
  }
  try {
    return (await import(file)) as Wrangler;
  } catch (error) {
    return `Couldn't load wrangler: ${(error as Error).message}`;
  }
}

/** How a binding is opened: where its entry points, and what Wrangler is asked to keep. */
interface Opening {
  entry: Record<string, unknown>;
  persist: { path: string } | false;
  remoteBindings: boolean;
  /** What to tell the person it is, given the binding's name. */
  describe: (binding: string) => string;
  /** What to say when Wrangler can't open it, given its reason. */
  failure: (binding: string, reason: string) => string;
}

async function open(
  cwd: string,
  { binding, accountId }: ChosenDatabase,
  opening: Opening,
): Promise<OpenBinding | string> {
  const wrangler = await projectWrangler(cwd);
  if (typeof wrangler === "string") return wrangler;
  const config = d1OnlyConfig(opening.entry, accountId);
  let proxy: Awaited<ReturnType<Wrangler["getPlatformProxy"]>>;
  try {
    proxy = await wrangler.getPlatformProxy({
      configPath: config.file,
      persist: opening.persist,
      remoteBindings: opening.remoteBindings,
    });
  } catch (error) {
    config.remove();
    return opening.failure(binding, (error as Error).message);
  }
  // A process that exits before `dispose` (a signal Wrangler turns into an exit) leaves no config.
  process.once("exit", config.remove);
  return {
    binding: proxy.env[binding],
    description: opening.describe(binding),
    dispose: async () => {
      process.off("exit", config.remove);
      try {
        await proxy.dispose();
      } finally {
        config.remove();
      }
    },
  };
}

/**
 * The chosen binding on the project's local D1, in the `.wrangler/state` beside the config that
 * `wrangler dev` and `wrangler d1 migrations apply --local` use (`getPlatformProxy`'s own default
 * is relative to the working directory, which can be anywhere). `remoteBindings: false` keeps it
 * local even for a binding the config marks `remote: true`, which Wrangler would otherwise use.
 */
export function openLocalBinding(
  cwd: string,
  chosen: ChosenDatabase,
): Promise<OpenBinding | string> {
  return open(cwd, chosen, {
    entry: chosen.entry,
    persist: { path: join(dirname(chosen.configFile), ".wrangler/state/v3") },
    remoteBindings: false,
    describe: (binding) => `Local database ${binding} (.wrangler/state)`,
    failure: (binding, reason) => `Wrangler couldn't open ${binding}: ${reason}`,
  });
}

const signInHint =
  "Sign in with 'wrangler login', or set CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID).";

/**
 * The chosen binding on the project's real D1, through Wrangler's remote proxy: its entry is
 * marked `remote: true` whatever the config says, since asking for `--remote` is the consent.
 * Nothing is kept locally. Which database that is follows Wrangler: `preview_database_id` first.
 */
export function openRemoteBinding(
  cwd: string,
  chosen: ChosenDatabase,
): Promise<OpenBinding | string> {
  const target = remoteTarget(chosen);
  return open(cwd, chosen, {
    entry: { ...chosen.entry, remote: true },
    persist: false,
    remoteBindings: true,
    describe: (binding) => remoteDescription(binding, target),
    failure: (binding, reason) =>
      `Wrangler couldn't open ${binding} remotely: ${reason}\n${signInHint}`,
  });
}
