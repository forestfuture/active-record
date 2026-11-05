// What a remote open of a D1 binding reaches, named for a person before anything is opened.
import { basename } from "node:path";
import type { ChosenDatabase, RemoteTarget } from "@forestfuture/active-record/cli";

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * The remote database this binding's entry points at: `preview_database_id` when there is one,
 * as `wrangler dev` opens it, or else `database_id`; or why there's none to open.
 */
export function remoteTarget({
  binding,
  entry,
  configFile,
}: ChosenDatabase): RemoteTarget | string {
  const previewId = text(entry["preview_database_id"]);
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
