// Postgres's SQL: numbered placeholders, lists as arrays, and bulk rows read into the table's own column types.
import { type Attribute, type Dialect, valueMark } from "@forestfuture/arbor/adapter";

/** A text literal, as an escape string, so it reads the same whatever `standard_conforming_strings` is. */
const literal = (text: string) => `E'${text.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;

/**
 * Text that's a UUID in its one form, lowercase with hyphens, as a uuid attribute holds it: text
 * in another form links to no UUID, just as on D1, which compares text exactly (#563).
 */
const uuidPattern = literal("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");

/** ASCII whitespace, the spaces `numeric` input allows around a number. */
const asciiSpace = "[ \\t\\n\\v\\f\\r]";

/**
 * Text that's an integer, as a condition casts one (#590): digits, a sign, and ASCII spaces around
 * them. Past leading zeros, it has at most 308 digits, below the largest number a record holds
 * (about 1.8e308), so neither its cast to `numeric` nor a comparison with a real, which casts it
 * on to `double precision`, can overflow and fail the query (#585). A regular expression's bound
 * stops at 255.
 */
const integerPattern = literal(`^${asciiSpace}*[+-]?0*[0-9]{1,255}[0-9]{0,53}${asciiSpace}*$`);

/**
 * Text that's a real number, as a condition casts one for a real or a decimal (#617): an integer
 * as above, or with a point, digits after it or before it, and an exponent of at most 4 digits,
 * so its cast to `numeric` can't overflow. A regular expression's bound stops at 255.
 */
const realPattern = literal(
  `^${asciiSpace}*[+-]?(0*[0-9]{1,255}[0-9]{0,53}([.][0-9]{0,255})?|[.][0-9]{1,255})([eE][+-]?[0-9]{1,4})?${asciiSpace}*$`,
);

/**
 * Whether `text` matches `pattern`, under C's collation: a collation that ignores case runs no
 * regular expression (#563). Only the test takes it, so a selected key keeps its column's.
 */
const matches = (text: string, pattern: string) => `${text} COLLATE "C" ~ ${pattern}`;

/** The kinds of value a link compares: numbers of any stored type together, any other alone. */
type Kind =
  | "text"
  | "number"
  | Exclude<Attribute["storedType"], "string" | "integer" | "real" | "decimal">;

/**
 * How Postgres compares an attribute's values: as a uuid, as text, as a number, or as its own
 * type (a date, a time, a timestamp, a boolean, JSON or bytes).
 */
function kindOf({ storedType }: Attribute): Kind {
  switch (storedType) {
    case "string":
      return "text";
    case "integer":
    case "real":
    case "decimal":
      return "number";
    default:
      return storedType;
  }
}

/** The kinds a link casts a key between, by its text: the others link only to their own kind. */
const isCastable = (kind: Kind): kind is "uuid" | "text" | "number" =>
  kind === "uuid" || kind === "text" || kind === "number";

/** The range of a `bigint`, which an integer attribute's column holds at most. */
const bigintRange = "BETWEEN -9223372036854775808 AND 9223372036854775807";

/**
 * The magnitudes a binary floating-point type's cast accepts, as powers of 2: those that round to
 * one of its values besides zero. They lie past half its least subnormal, `2 ** -lowest`, which
 * rounds to zero, and below the midpoint of its greatest value and the next power of 2, `2 **
 * highest - 2 ** step`, which rounds to infinity: the cast refuses both (#623).
 */
interface Magnitudes {
  readonly lowest: bigint;
  readonly highest: bigint;
  readonly step: bigint;
}

/** A `double precision`'s magnitudes (#585). */
const doubleMagnitudes: Magnitudes = { lowest: 1075n, highest: 1024n, step: 970n };

/** A 4-byte `real`'s (`float4`) magnitudes (#623). */
const float4Magnitudes: Magnitudes = { lowest: 150n, highest: 128n, step: 103n };

/**
 * Whether `number`, a `numeric`, is within `magnitudes`, compared exactly: the least bound as
 * its product with `2 ** lowest`, whole, as a `numeric` holds a fraction that small only
 * rounded.
 */
function isWithin(number: string, { lowest, highest, step }: Magnitudes): string {
  const limit = 2n ** highest - 2n ** step;
  return `ABS(${number}) * ${2n ** lowest} > 1 AND ABS(${number}) < ${limit}`;
}

/** Number text as a `numeric`, which holds it exactly. */
const asNumeric = (text: string) => `CAST(${text} AS NUMERIC)`;

/**
 * Real-number text as `type`, when it's zero or within `magnitudes`, those `type` holds;
 * otherwise NULL, which links nothing rather than failing the cast.
 */
function realCast(text: string, type: string, magnitudes: Magnitudes): string {
  const number = asNumeric(text);
  return `CASE WHEN ${number} = 0 OR ${isWithin(number, magnitudes)} THEN CAST(${text} AS ${type}) END`;
}

/**
 * Real-number text as a `double precision`, rounded first to a 4-byte `real` for a `float4`
 * column, as a condition bound to it reads its value, so a fraction links to the `real` it
 * rounds to (#623). Postgres widens both the column and the rounded value exactly. The column's type is read from a query of its table that
 * finds no row, not from the row being linked, so the test is the same for every row and the
 * column's index is still searched. A query names the table as a table: a cast to its row type
 * would find a type of Postgres's own first, should the table share its name (`point`).
 */
function linkedReal(text: string, linked: Attribute): string {
  const column = `(SELECT ${quoted(linked.column)} FROM ${quoted(linked.table)} WHERE false)`;
  const type = `pg_typeof(${column})`;
  return (
    `CASE WHEN ${type} = 'real'::regtype THEN ${realCast(text, "REAL", float4Magnitudes)} ` +
    `ELSE ${realCast(text, "DOUBLE PRECISION", doubleMagnitudes)} END`
  );
}

/**
 * `text` as the number it holds, cast to the type of `linked`'s column, so a comparison with that
 * column searches its index (#618): an integer's `bigint`, a real's `double precision` (rounded to a `real` for a `float4`)
 * and a decimal's `numeric`. A real or a decimal takes a point and an exponent, as a condition
 * does (#617). Text past the type's range links nothing rather than failing the cast. Each CASE
 * decides before the next cast runs.
 */
function linkedNumber(text: string, linked: Attribute): string {
  if (linked.storedType === "integer") {
    return `CASE WHEN ${matches(text, integerPattern)} THEN CASE WHEN ${asNumeric(text)} ${bigintRange} THEN CAST(${text} AS BIGINT) END END`;
  }
  const isReal = matches(text, realPattern);
  if (linked.storedType === "real")
    return `CASE WHEN ${isReal} THEN ${linkedReal(text, linked)} END`;
  // The one other number kind, a decimal, is held as a numeric.
  return `CASE WHEN ${isReal} THEN ${asNumeric(text)} END`;
}

/** A quoted identifier; embedded double quotes are doubled. */
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** A function call takes at most 100 arguments: 50 key and value pairs to an object. */
const pairsPerObject = 50;

/** One JSON object of `pairs`, joined from as many `jsonb_build_object` calls as they need. */
function jsonObject(pairs: readonly string[]): string {
  const parts: string[] = [];
  for (let start = 0; start < pairs.length; start += pairsPerObject) {
    parts.push(`jsonb_build_object(${pairs.slice(start, start + pairsPerObject).join(", ")})`);
  }
  return parts.join(" || ");
}

/**
 * An attribute's cell in a bulk row: bytes are hex text in the JSON (#20), read as `bytea`,
 * whose JSON form (`"\\x0102"`) the row reads back as bytes.
 */
function rowCell(table: string, { column, isJson, isBinary }: Attribute, index: number): string {
  if (isBinary) return `to_jsonb(decode(cells ->> ${index}, 'hex'))`;
  return isJson ? jsonCell(table, column, index) : `cells -> ${index}`;
}

/**
 * A json attribute's cell, which is its JSON's text: read as JSON for a json or jsonb column,
 * which would otherwise keep it as a JSON string, and kept as that text for any other column.
 */
function jsonCell(table: string, column: string, index: number): string {
  const type = `pg_typeof((NULL::${table}).${quoted(column)})`;
  return (
    `CASE WHEN ${type} IN ('json'::regtype, 'jsonb'::regtype) ` +
    `THEN (cells ->> ${index})::jsonb ELSE cells -> ${index} END`
  );
}

export const postgres: Dialect = {
  placeholder: (index) => `$${index}`,
  inList: (column, cells) => ({ sql: `${column} = ANY(${valueMark})`, value: [...cells] }),
  // array_position finds a NULL too, and gives a value's first place.
  placeInList: (column, cells) => ({
    sql: `array_position(${valueMark}, ${column})`,
    value: [...cells],
  }),
  pagination(limit, offset, params) {
    let text = "";
    if (limit !== undefined) {
      params.push(limit);
      text += ` LIMIT ${valueMark}`;
    }
    if (offset !== undefined) {
      params.push(offset);
      text += ` OFFSET ${valueMark}`;
    }
    return text;
  },
  /**
   * Postgres compares no text with a number, nor a uuid with either (#563). A key selected for a
   * text attribute is its text; text selected for a uuid is the UUID it holds in its one form, and
   * for a number the number it holds, as a condition casts it, in the number's own type (#617,
   * #618); text that isn't one matches nothing. Only the key is cast, so the linked attribute's
   * column keeps its index. A date, a time, a timestamp, a boolean, JSON or bytes, linked either
   * way to a key of another type, matches nothing (#586): Postgres compares most of them with no
   * other type, and a date with a timestamp, which it can compare, links nothing on D1, which
   * compares their text.
   */
  linkedKey(key, keyAttribute, linked) {
    const kind = kindOf(linked);
    const keyKind = kindOf(keyAttribute);
    if (kind === keyKind) return key;
    if (!isCastable(kind) || !isCastable(keyKind)) return undefined;
    const text = `CAST(${key} AS TEXT)`;
    switch (kind) {
      case "uuid":
        return `CASE WHEN ${matches(text, uuidPattern)} THEN CAST(${text} AS UUID) END`;
      case "text":
        return text;
      case "number":
        return linkedNumber(text, linked);
    }
  },
  /**
   * The write returns a row if it changed one, and the statement casts the marker to an integer
   * when it returned none, which fails the transaction with the marker in its message (#357).
   * The cast is of the CASE, which reads the write's rows, so it can't be made before it runs.
   */
  staleGuard(write, marker) {
    const check = `CASE WHEN NOT EXISTS (SELECT FROM locked) THEN CAST(${valueMark} AS TEXT) END`;
    return [
      {
        sql: `WITH locked AS (${write.sql} RETURNING 1) SELECT CAST(${check} AS INTEGER) AS stale`,
        params: [...write.params, marker],
        model: write.model,
      },
    ];
  },
  /** `json` has no equality operator, so a json attribute's values are compared as text. */
  sameValue(left, right, { isJson }) {
    if (isJson) return `CAST(${left} AS TEXT) IS NOT DISTINCT FROM CAST(${right} AS TEXT)`;
    return `${left} IS NOT DISTINCT FROM ${right}`;
  },
  /**
   * The removal returns a row for each row it removed, which the counters' UPDATEs count, and the
   * statement selects how many as `removed`: a COUNT sent before it could miss a row another
   * request commits in between, on a snapshot of its own (#61).
   */
  countedRemoval(removal, decrements) {
    const counted = decrements("(SELECT COUNT(*) FROM removed)");
    const ctes = counted.map(({ sql }, index) => `counted${index} AS (${sql})`);
    return {
      sql: `WITH removed AS (${removal.sql} RETURNING 1), ${ctes.join(", ")} SELECT COUNT(*) AS removed FROM removed`,
      params: [...removal.params, ...counted.flatMap(({ params }) => params)],
      model: removal.model,
    };
  },
  /**
   * Each row's cells become an object of its columns, read into a record of `table`, so every
   * value converts to its column's own type as an insert's would.
   */
  bulkRows(table, attributes) {
    const pairs = attributes.map((attribute, index) => {
      return `${literal(attribute.column)}, ${rowCell(table, attribute, index)}`;
    });
    return {
      select: attributes.map(({ column }) => `row.${quoted(column)}`).join(", "),
      from:
        `jsonb_array_elements(${valueMark}::jsonb) AS cells, ` +
        `jsonb_populate_record(NULL::${table}, ${jsonObject(pairs)}) AS row`,
    };
  },
};
