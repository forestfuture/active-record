// Opening a client from a connection string within its time limit: its `connect_timeout`, read as libpq reads it, or 10 seconds, and the error when it takes longer.
import pg from "pg";

/** The limit when the connection string sets none, in milliseconds. */
const defaultTimeoutMs = 10_000;

/** The longest a timer waits, in milliseconds (about 24 days): it fires at once for longer. */
const longestTimeoutMs = 2 ** 31 - 1;

/** libpq's shortest limit, in seconds: a `connect_timeout` of 1 waits 2. */
const shortestTimeoutSeconds = 2;

/** A whole number as libpq reads one: a sign, digits, and spaces around them. */
const wholeNumber = /^\s*[-+]?\d+\s*$/;

/**
 * `pg`'s `connectionTimeoutMillis` for clients opened from `connectionString`: its `connect_timeout`
 * in seconds, as libpq takes it (`pg` reads it only through libpq), where 0 or less sets no limit.
 * Throws `TypeError` for a value that isn't a whole number, as libpq refuses one, naming the
 * parameter but not the connection string, which may hold a password.
 */
export function connectTimeoutOf(connectionString: string): number {
  const value = queryParameter(connectionString, "connect_timeout");
  if (value === undefined) return defaultTimeoutMs;
  if (!wholeNumber.test(value)) {
    throw new TypeError(
      `connect_timeout must be a whole number of seconds, not ${JSON.stringify(value)}`,
    );
  }
  const seconds = Number.parseInt(value, 10);
  if (seconds <= 0) return 0;
  return Math.min(Math.max(seconds, shortestTimeoutSeconds) * 1000, longestTimeoutMs);
}

/**
 * A parameter of a connection string's query, or undefined when it has none. The query is read
 * on its own, after the first `?` and before any `#`, as a URL's is: `pg` takes strings a URL
 * can't parse, such as a socket's with no host (`postgres://app@/app?host=/tmp`).
 */
function queryParameter(connectionString: string, name: string): string | undefined {
  const start = connectionString.indexOf("?");
  if (start === -1) return undefined;
  const query = connectionString.slice(start + 1).split("#")[0];
  return new URLSearchParams(query).get(name) ?? undefined;
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
