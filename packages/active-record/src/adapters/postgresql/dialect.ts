// Postgres's SQL: numbered placeholders, lists as arrays, and bulk rows read into the table's own column types.
import { type Attribute, type Dialect, valueMark } from "@forestfuture/active-record/adapter";

/** A text literal, as an escape string, so it reads the same whatever `standard_conforming_strings` is. */
const literal = (text: string) => `E'${text.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;

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
   * Postgres compares no text with a number. A number selected for a text attribute is its text,
   * and text selected for a number is the number its digits are, as a condition casts it; text
   * that isn't one matches nothing.
   */
  linkedKey(key, keyAttribute, linked) {
    if (linked.isText === keyAttribute.isText) return key;
    if (linked.isText) return `CAST(${key} AS TEXT)`;
    return `CASE WHEN ${key} ~ ${literal("^\\s*[+-]?[0-9]+\\s*$")} THEN CAST(${key} AS NUMERIC) END`;
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
