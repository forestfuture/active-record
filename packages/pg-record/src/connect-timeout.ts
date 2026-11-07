// How long opening a client from a connection string may take: its `connect_timeout`, read as libpq reads it, or 10 seconds.

/** The limit when the connection string sets none, in milliseconds. */
const defaultTimeout = 10_000;

/** libpq's shortest limit, in seconds: a `connect_timeout` of 1 waits 2. */
const shortestTimeout = 2;

/** A whole number as libpq reads one: a sign, digits, and spaces around them. */
const wholeNumber = /^\s*[-+]?\d+\s*$/;

/**
 * `pg`'s `connectionTimeoutMillis` for clients opened from `connectionString`: its `connect_timeout`
 * in seconds, as libpq takes it (`pg` reads it only through libpq), where 0 or less sets no limit.
 * Throws `TypeError` for a value that isn't a whole number, as libpq refuses one, naming the
 * parameter but not the connection string, which may hold a password.
 */
export function connectTimeoutOf(connectionString: string): number {
  const value = parameter(connectionString, "connect_timeout");
  if (value === undefined) return defaultTimeout;
  if (!wholeNumber.test(value)) {
    throw new TypeError(
      `connect_timeout must be a whole number of seconds, not ${JSON.stringify(value)}`,
    );
  }
  const seconds = Number.parseInt(value, 10);
  if (seconds <= 0) return 0;
  return Math.max(seconds, shortestTimeout) * 1000;
}

/** A parameter of a connection string's query, or undefined when it has none, or can't be read. */
function parameter(connectionString: string, name: string): string | undefined {
  try {
    return new URL(connectionString).searchParams.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}
