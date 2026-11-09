// A database's connection strings from its config entry: written out, or read from the environment with `${NAME}`.
import pg from "pg";

/** `${NAME}`: a variable's value, put in its place. */
const variable = /\$\{(\w+)\}/g;

/**
 * The connection string an entry's `setting` holds, with each `${NAME}` read from the environment;
 * undefined when it has none, or why it can't be read. It's never printed: it can hold a password.
 */
export function connectionString(
  entry: Record<string, unknown> | undefined,
  setting: "url" | "remoteUrl" | "schemaUrl",
): string | { error: string } | undefined {
  const value = entry?.[setting];
  if (typeof value !== "string") return undefined;
  const unset = [...value.matchAll(variable)].find(([, name]) => process.env[name!] === undefined);
  if (unset !== undefined)
    return { error: `The database's ${setting} names ${unset[0]}, which isn't set` };
  return value.replaceAll(variable, (_, name: string) => process.env[name]!);
}

/** The server and database `pg` connects to with a connection string, as it reads one; none when it can't. */
function parsed(url: string): { host: string; database: string } | undefined {
  try {
    const client = new pg.Client({ connectionString: url });
    return { host: client.host, database: client.database ?? client.user ?? "postgres" };
  } catch {
    return undefined;
  }
}

/** Where a connection string points, for a person: its host (or socket folder), never its password. */
export function hostOf(url: string): string {
  return parsed(url)?.host || "its server";
}

/** The database a connection string names, for a person to type: as `pg` reads it, its user's by default. */
export function databaseNameOf(url: string): string {
  return parsed(url)?.database ?? "postgres";
}
