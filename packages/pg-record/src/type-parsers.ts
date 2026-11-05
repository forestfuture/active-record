// How Postgres's values read as the core keeps them (#265): booleans as 1 and 0, times as ISO text, JSON as its text, and bigints as numbers while they're safe.
import pg from "pg";
import type { TypeParsers } from "./clients.ts";

/** Postgres's type OIDs this adapter reads its own way. */
const oids = {
  bool: 16,
  int8: 20,
  json: 114,
  date: 1082,
  timestamp: 1114,
  timestamptz: 1184,
  jsonb: 3802,
} as const;

const asText = (text: string) => text;

/**
 * A `bigint`'s number, or the value as a JavaScript `bigint` past a safe integer, which the core
 * refuses to read, naming its attribute, so a key is never silently wrong.
 */
function int8(text: string): number | bigint {
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : BigInt(text);
}

/** A `timestamptz` as ISO text, or its own text when it's no instant (`infinity`). */
function timestamptz(text: string): string {
  const read = pg.types.getTypeParser(oids.timestamptz)(text);
  return read instanceof Date && !Number.isNaN(read.getTime()) ? read.toISOString() : text;
}

const parsers: Record<number, (text: string) => unknown> = {
  [oids.bool]: (text) => (text === "t" ? 1 : 0),
  [oids.int8]: int8,
  [oids.json]: asText,
  [oids.jsonb]: asText,
  // Without a zone, Postgres's text is read as the core reads zoneless text, not in local time.
  [oids.date]: asText,
  [oids.timestamp]: asText,
  [oids.timestamptz]: timestamptz,
};

/**
 * What each query reads its columns with: given per query, so the app's own `pg` (and its
 * Pool's other queries) keep `pg`'s defaults.
 */
export const typeParsers: TypeParsers = {
  getTypeParser(oid, format) {
    return (
      (format === undefined || format === "text" ? parsers[oid] : undefined) ??
      pg.types.getTypeParser(oid, format)
    );
  },
};
