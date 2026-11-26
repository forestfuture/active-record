// Opening a client from a connection string within its time limit: its `connect_timeout`, read as libpq reads it, or 10 seconds, and the error when it takes longer.
import pg from "pg";

/** The limit when the connection string sets none, in milliseconds. */
const defaultTimeoutMs = 10_000;

/** The longest a timer waits, in milliseconds (about 24 days): it fires at once for longer. */
const longestTimeoutMs = 2 ** 31 - 1;

/** libpq's shortest limit, in seconds: a `connect_timeout` of 1 waits 2. */
const shortestTimeoutSeconds = 2;

/**
 * ASCII whitespace, `[ \t\n\v\f\r]`: the spaces libpq's `strtol` and `isspace` skip around a
 * number, where `\s` would read a no-break space too (#598).
 */
const asciiSpace = "[ \\t\\n\\v\\f\\r]";

/** A whole number as libpq reads one: a sign, digits, and ASCII spaces around them. */
const wholeNumber = new RegExp(`^${asciiSpace}*[-+]?[0-9]+${asciiSpace}*$`);

/** The range of a C `int`, as libpq reads the number into one (#602). */
const intRange = { least: -(2 ** 31), most: 2 ** 31 - 1 };

/**
 * `pg`'s `connectionTimeoutMillis` for clients opened from `connectionString`: its `connect_timeout`
 * in seconds, as libpq takes it (`pg` reads it only through libpq), where 0 or less sets no limit.
 * Throws `TypeError` for a value that isn't a whole number, or doesn't fit libpq's `int`, as
 * libpq refuses one, naming the parameter but not the connection string, which may hold a password.
 */
export function connectTimeoutOf(connectionString: string): number {
  const value = queryParameter(connectionString, "connect_timeout");
  if (value === undefined) return defaultTimeoutMs;
  const seconds = secondsOf(value);
  if (seconds <= 0) return 0;
  return Math.min(Math.max(seconds, shortestTimeoutSeconds) * 1000, longestTimeoutMs);
}

/**
 * `connect_timeout`'s seconds, or a `TypeError` for a value libpq refuses: one that isn't a whole
 * number, or doesn't fit its `int`.
 */
function secondsOf(value: string): number {
  if (!wholeNumber.test(value)) {
    throw new TypeError(
      `connect_timeout must be a whole number of seconds, not ${JSON.stringify(value)}`,
    );
  }
  const seconds = Number.parseInt(value, 10);
  if (seconds < intRange.least || seconds > intRange.most) {
    throw new TypeError(
      `connect_timeout must be from ${intRange.least} to ${intRange.most} seconds, not ${JSON.stringify(value)}`,
    );
  }
  return seconds;
}

/**
 * A parameter of a connection string's query (its last, when it's given twice, as `pg` reads it),
 * or undefined when it has none. The query is read on its own, before any `#` and after the first
 * `?`, as a URL's is: `pg` takes strings a URL can't parse, such as a socket's with no host
 * (`postgres://app@/app?host=/tmp`). It is percent-decoded only, as libpq decodes it, so a `+`
 * stays a `+` where a form would read a space.
 */
function queryParameter(connectionString: string, name: string): string | undefined {
  const [beforeFragment = ""] = connectionString.split("#");
  const start = beforeFragment.indexOf("?");
  if (start === -1) return undefined;
  const query = beforeFragment.slice(start + 1).replaceAll("+", "%2B");
  return new URLSearchParams(query).getAll(name).at(-1);
}

/**
 * A client of `connectionString`'s, connected: `pg` gives up on it after `timeoutMs` (0: never).
 * An open that took that long fails with libpq's `timeout expired`, `pg`'s own error as its
 * cause, on Workers too, where `pg` reports it as a dropped connection.
 */
export async function openClient(
  connectionString: string,
  timeoutMs: number,
): Promise<InstanceType<typeof pg.Client>> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: timeoutMs });
  // A connection lost while idle is reported here; unheard, it would crash a Node process.
  client.on("error", () => {});
  if (timeoutMs === 0) return client.connect().then(() => client);
  let expired = false;
  // Started before `pg`'s, with the same delay, so it has fired by the time `pg` gives up.
  const timer = setTimeout(() => (expired = true), timeoutMs);
  try {
    await client.connect();
    return client;
  } catch (error) {
    throw expired ? new Error("timeout expired", { cause: error }) : error;
  } finally {
    clearTimeout(timer);
  }
}
