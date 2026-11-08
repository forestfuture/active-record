// A database's connection strings from its config entry: written out, or read from the environment with `${NAME}`.

/** `${NAME}`: a variable's value, put in its place. */
const variable = /\$\{(\w+)\}/g;

/**
 * The connection string an entry's `setting` holds, with each `${NAME}` read from the environment;
 * undefined when it has none, or why it can't be read. It's never printed: it can hold a password.
 */
export function connectionString(
  entry: Record<string, unknown> | undefined,
  setting: "url" | "remoteUrl",
): string | { error: string } | undefined {
  const value = entry?.[setting];
  if (typeof value !== "string") return undefined;
  const unset = [...value.matchAll(variable)].find(([, name]) => process.env[name!] === undefined);
  if (unset !== undefined)
    return { error: `The database's ${setting} names ${unset[0]}, which isn't set` };
  return value.replaceAll(variable, (_, name: string) => process.env[name]!);
}

/** Where a connection string points, for a person: its host, never its password. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "a local socket";
  } catch {
    return "its server";
  }
}

/** The database a connection string names, for a person to type: its path, or else its user's. */
export function databaseNameOf(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.slice(1) || parsed.username) || "postgres";
  } catch {
    return "postgres";
  }
}
