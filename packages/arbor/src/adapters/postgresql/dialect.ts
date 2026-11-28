// Postgres's SQL: numbered placeholders, lists as arrays, and bulk rows read into the table's own column types.
import { type Attribute, type Dialect, valueMark } from "@forestfuture/arbor/adapter";

/** A text literal, as an escape string, so it reads the same whatever `standard_conforming_strings` is. */
const literal = (text: string) => `E'${text.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;

/**
 * The magnitudes a binary floating-point type's cast accepts, as powers of 2: those that round to
 * one of its values besides zero. They lie past half its least subnormal, `2 ** -lowest`, which
 * rounds to zero, and below the midpoint of its greatest value and the next power of 2,
 * `2 ** highest - 2 ** step`, which rounds to infinity: the cast refuses both (#623).
 */
interface Magnitudes {
  readonly lowest: bigint;
  readonly highest: bigint;
  readonly step: bigint;
}

/** Whether `attribute` is a number of any stored type: an integer, a real or a decimal. */
const isNumber = ({ storedType }: Attribute) =>
  storedType === "integer" || storedType === "real" || storedType === "decimal";

/** A 4-byte `real`'s (`float4`) magnitudes (#623). */
const float4Magnitudes: Magnitudes = { lowest: 150n, highest: 128n, step: 103n };

/** A `double precision`'s (`float8`) magnitudes (#628). */
const float8Magnitudes: Magnitudes = { lowest: 1075n, highest: 1024n, step: 970n };

/**
 * Whether `number`, a `numeric`, is within `magnitudes`, compared exactly. The least bound is
 * compared as its product with `2 ** lowest`, a whole number, since a `numeric` holds a fraction
 * that small only rounded. The product is taken only below the greatest bound, so a `numeric` of
 * any size can't overflow it.
 */
function isWithin(number: string, { lowest, highest, step }: Magnitudes): string {
  const limit = 2n ** highest - 2n ** step;
  return `CASE WHEN ABS(${number}) < ${limit} THEN ABS(${number}) * ${2n ** lowest} > 1 ELSE false END`;
}

/** Whether a cast of `number`, a `numeric`, accepts it: zero, or within `magnitudes`. */
const isHeld = (number: string, magnitudes: Magnitudes) =>
  `${number} = 0 OR ${isWithin(number, magnitudes)}`;

/**
 * `selected` from a query of `table`, already quoted, that finds no row: NULL, of the type
 * `selected` has in the table. A query names the table as a table, where a cast to its row type
 * (`NULL::"point"`) would find a type of Postgres's own first, should the table share its name
 * (#623, #626).
 */
const noRowOf = (table: string, selected: string) =>
  `(SELECT ${selected} FROM ${table} WHERE false)`;

/**
 * Whether a cast of `decimal` to a binary floating-point type accepts it: held within
 * `magnitudes`, or an infinity or NaN, which a `numeric` orders past every number. It's compared
 * as a `numeric`, so a decimal attribute declared over a `real` column compares too (#628).
 */
function isHeldDecimal(decimal: string, magnitudes: Magnitudes): string {
  const number = `CAST(${decimal} AS NUMERIC)`;
  return `${isHeld(number, magnitudes)} OR ABS(${number}) >= 'Infinity'`;
}

/**
 * Whether `attribute`'s column is a 4-byte `real` (`float4`). Its type is read from a query of
 * its table that finds no row, not from the row being linked, so the test is the same for every
 * row and the column's index is still searched.
 */
function isFloat4({ table, column }: Attribute): string {
  return `pg_typeof(${noRowOf(quoted(table), quoted(column))}) = 'real'::regtype`;
}

/**
 * Whether `number`, a `double precision`, is one a cast to a `real` accepts: zero, an infinity,
 * NaN, which Postgres orders past them, or within `magnitudes`. Each bound is an exact power of 2,
 * so it's compared without rounding, and nothing is multiplied, so nothing can overflow.
 */
function isRealDouble(number: string, { lowest, highest, step }: Magnitudes): string {
  const power = (exponent: bigint) => `CAST(2 AS DOUBLE PRECISION) ^ (${exponent})`;
  const magnitude = `ABS(${number})`;
  const within = `${magnitude} > ${power(-lowest)} AND ${magnitude} < ${power(highest)} - ${power(step)}`;
  return `${number} = 0 OR ${magnitude} >= 'Infinity' OR (${within})`;
}

/**
 * A `double precision` or decimal key as a `real`, when a `real` holds it; otherwise NULL, which
 * links nothing. A decimal is compared as a `numeric`, exactly, since it may hold a number past a
 * `double precision`'s range; its infinities and NaN link.
 */
function asReal(key: string, { storedType }: Attribute): string {
  const holds =
    storedType === "real"
      ? isRealDouble(key, float4Magnitudes)
      : isHeldDecimal(key, float4Magnitudes);
  return `CASE WHEN ${holds} THEN CAST(${key} AS REAL) END`;
}

/**
 * A real or decimal key as a `double precision`. A decimal is cast only when a `double precision`
 * holds it, compared as a `numeric`; otherwise it's NULL, which links nothing rather than failing
 * the query (#628). Its infinities and NaN link.
 */
function asDouble(key: string, { storedType }: Attribute): string {
  if (storedType === "real") return `CAST(${key} AS DOUBLE PRECISION)`;
  return `CASE WHEN ${isHeldDecimal(key, float8Magnitudes)} THEN CAST(${key} AS DOUBLE PRECISION) END`;
}

/**
 * A real key as `type`, read through its text: under Postgres's default `extra_float_digits`,
 * the shortest that reads back as the same value (`0.1`), rather than its exact widening. Its
 * record reads the same text under any setting, so the link compares the value the record holds.
 */
const throughText = (key: string, type: string) => `CAST(CAST(${key} AS TEXT) AS ${type})`;

/** Whether `attribute` alone is a `float4`: `other`, when it's a real too, isn't one. */
function isOnlyFloat4(attribute: Attribute, other: Attribute): string {
  const otherIsWide = other.storedType === "real" ? ` AND NOT ${isFloat4(other)}` : "";
  return isFloat4(attribute) + otherIsWide;
}

/**
 * A number key linked to a number of another width or type, compared at a `float4`'s precision
 * when either is a `float4` real rather than by widening the `float4` (#625). A `double
 * precision` or a decimal linked to a `float4` is rounded to a `real`, as a condition bound to
 * it reads its value, and a `float4` linked to a `double precision` is read through its text, as
 * its record holds it. A real of either width linked to a decimal is read through its text as a
 * `numeric`, so the decimal's index is searched and a decimal of any size compares without
 * failing. Every other link compares as a `double precision`, which Postgres widens a `float4`
 * column to exactly, so the CASE's branches agree on one type, and a decimal a `double precision`
 * can't hold links nothing (#628). An integer on either side is left as it is: a `float4` that
 * equals an integer widens to it exactly.
 */
function linkedWidth(key: string, keyAttribute: Attribute, linked: Attribute): string {
  if (keyAttribute.storedType === "integer" || linked.storedType === "integer") return key;
  if (linked.storedType === "decimal") {
    return keyAttribute.storedType === "real" ? throughText(key, "NUMERIC") : key;
  }
  // The linked attribute is a real.
  const cases = [`WHEN ${isOnlyFloat4(linked, keyAttribute)} THEN ${asReal(key, keyAttribute)}`];
  if (keyAttribute.storedType === "real") {
    const shortest = throughText(key, "DOUBLE PRECISION");
    cases.push(`WHEN ${isOnlyFloat4(keyAttribute, linked)} THEN ${shortest}`);
  }
  return `CASE ${cases.join(" ")} ELSE ${asDouble(key, keyAttribute)} END`;
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
  const type = `pg_typeof(${noRowOf(table, quoted(column))})`;
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
   * A number key linked to a number of another width or type is compared at the narrower one's
   * precision (#625); any other key, linked to its own kind, is selected as it is.
   */
  linkedKey: (key, keyAttribute, linked) =>
    isNumber(linked) && isNumber(keyAttribute) ? linkedWidth(key, keyAttribute, linked) : key,
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
   * value converts to its column's own type as an insert's would. The record's type is a row of
   * `table` that a query finds none of. COALESCE makes `table.*` an expression, which is the
   * table's whole row: alone it would be its columns, and a bare `table` would be a column of
   * that name, should the table have one.
   */
  bulkRows(table, attributes) {
    const pairs = attributes.map((attribute, index) => {
      return `${literal(attribute.column)}, ${rowCell(table, attribute, index)}`;
    });
    const emptyRow = noRowOf(table, `COALESCE(${table}.*)`);
    return {
      select: attributes.map(({ column }) => `row.${quoted(column)}`).join(", "),
      from:
        `jsonb_array_elements(${valueMark}::jsonb) AS cells, ` +
        `jsonb_populate_record(${emptyRow}, ${jsonObject(pairs)}) AS row`,
    };
  },
};
