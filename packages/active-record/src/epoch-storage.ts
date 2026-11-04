// The two ways a datetime is kept as a Unix epoch integer, as Drizzle's timestamp modes write it (#73).

/** A datetime held in an `INTEGER` column as seconds or milliseconds since 1970. */
export const epochStorages = ["unixSeconds", "unixMilliseconds"] as const;

export type EpochStorage = (typeof epochStorages)[number];
