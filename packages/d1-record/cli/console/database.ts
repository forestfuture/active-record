// Which D1 database the console opens, and what a remote open reaches.
import { chooseDatabase, readWranglerConfig } from "../project/wrangler.ts";

/** The binding to open, and the Wrangler config file that declares it. */
export interface ChosenDatabase {
  binding: string;
  /** Its `d1_databases` entry, as the config has it. */
  entry: Record<string, unknown>;
  configFile: string;
  /** The config's `account_id`, which a Wrangler config of the console's own would lose. */
  accountId?: string;
}

/** What opening a binding remotely reaches: named for a person, before anything is opened. */
export interface RemoteTarget {
  /** Its `database_name`, or the binding when the config has none. */
  name: string;
  /** The id Wrangler opens: `preview_database_id` when there is one, as `wrangler dev` does. */
  id: string | undefined;
  preview: boolean;
}

/** The remote database this binding's entry points at. */
export function remoteTarget({ binding, entry }: ChosenDatabase): RemoteTarget {
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
  const preview = text(entry.preview_database_id);
  return {
    name: text(entry.database_name) ?? binding,
    id: preview ?? text(entry.database_id),
    preview: preview !== undefined,
  };
}

/** "Remote database DB (shop, id 1a2b)": what a remote binding is, for a person to read. */
export function remoteDescription(binding: string, { name, id, preview }: RemoteTarget): string {
  return `Remote ${preview ? "preview database" : "database"} ${binding} (${name}, id ${id})`;
}

/** The database for `--database` (and `--config`), or why there isn't one to open. */
export function databaseFor(
  cwd: string,
  options: { config?: string; database?: string },
): ChosenDatabase | string {
  const config = readWranglerConfig(cwd, options.config);
  if (!config.ok) return config.error;
  const chosen = chooseDatabase(config.databases, options.database);
  if (typeof chosen === "string") return chosen;
  const found = { binding: chosen.binding, entry: chosen.entry, configFile: config.file };
  return config.accountId === undefined ? found : { ...found, accountId: config.accountId };
}
