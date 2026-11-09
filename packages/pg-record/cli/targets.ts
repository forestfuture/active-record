// Which database a command reaches: the entry's url, or with `--remote` its remoteUrl, named for a person by its database and host.
import { basename } from "node:path";
import type { ChosenDatabase, RemoteTarget } from "@forestfuture/active-record/cli";
import { connectionString, databaseNameOf, hostOf } from "./urls.ts";

/** A database, named for a person: its binding, its database's name and its host. */
const described = (kind: string, binding: string, url: string) =>
  `${kind} database ${binding} (${databaseNameOf(url)} on ${hostOf(url)})`;

/** The real database the entry's `remoteUrl` names, or why there's none. */
export function remoteTarget(chosen: ChosenDatabase): RemoteTarget | string {
  const reached = target(chosen, true);
  if (typeof reached === "string") return reached;
  return { name: databaseNameOf(reached.url), description: reached.description };
}

/**
 * The connection string a command uses, local or remote, and how it names the database; or why
 * there's none, saying who needs it.
 */
export function target(
  chosen: ChosenDatabase,
  remote: boolean,
  needs = "migrate needs",
): { url: string; description: string } | string {
  const setting = remote ? "remoteUrl" : "url";
  const url = connectionString(chosen.entry, setting);
  if (url === undefined) {
    const need = remote ? "--remote needs" : `${needs} for the local database`;
    return `${chosen.binding} has no ${setting} in ${basename(chosen.configFile)}, which ${need}`;
  }
  if (typeof url !== "string") return url.error;
  return { url, description: described(remote ? "Remote" : "Local", chosen.binding, url) };
}
