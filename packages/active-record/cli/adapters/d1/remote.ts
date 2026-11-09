// What a remote open of a D1 binding reaches, named for a person before anything is opened.
import { basename } from "node:path";
import type { ChosenDatabase, RemoteTarget } from "@forestfuture/active-record/cli";

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * The remote database this binding's entry points at, or why there's none: for the console,
 * `preview_database_id` when there is one, as `wrangler dev` opens it, or else `database_id`; for
 * `migrate`, always `database_id`, the one `wrangler d1 migrations apply --remote` changes.
 */
export function remoteTarget(
  { binding, entry, configFile }: ChosenDatabase,
  use: "open" | "migrate" = "open",
): RemoteTarget | string {
  const previewId = use === "open" ? text(entry["preview_database_id"]) : undefined;
  const id = previewId ?? text(entry["database_id"]);
  if (id === undefined) {
    return `${binding} has no database_id in ${basename(configFile)}, which --remote needs`;
  }
  const name = text(entry["database_name"]) ?? binding;
  const kind = previewId === undefined ? "database" : "preview database";
  const target: RemoteTarget = {
    name,
    description: `Remote ${kind} ${binding} (${name}, id ${id})`,
  };
  return previewId === undefined
    ? target
    : {
        ...target,
        note: "That is the config's preview_database_id, which Wrangler opens in place of database_id.",
      };
}
