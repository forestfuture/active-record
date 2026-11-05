// Postgres's SQL: numbered placeholders, lists as arrays, and bulk rows read into the table's own column types.
import { type Dialect, param } from "@forestfuture/active-record/adapter";

/** A text literal. */
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

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

export const postgres: Dialect = {
  placeholder: (index) => `$${index}`,
  inList: (column, cells) => ({ sql: `${column} = ANY(${param})`, value: [...cells] }),
  pagination(limit, offset, params) {
    let text = "";
    if (limit !== undefined) {
      params.push(limit);
      text += ` LIMIT ${param}`;
    }
    if (offset !== undefined) {
      params.push(offset);
      text += ` OFFSET ${param}`;
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
    return `CASE WHEN ${key} ~ '^\\s*[+-]?[0-9]+\\s*$' THEN CAST(${key} AS NUMERIC) END`;
  },
  /**
   * Each row's cells become an object of its columns, read into a record of `table`, so every
   * value converts to its column's own type as an insert's would. A json attribute's cell is its
   * JSON's text, so it's read as JSON first, or it would be stored as a JSON string.
   */
  bulkRows(table, attributes) {
    const pairs = attributes.map(({ column, isJson }, index) => {
      const cell = isJson ? `(cells ->> ${index})::jsonb` : `cells -> ${index}`;
      return `${literal(column)}, ${cell}`;
    });
    return {
      select: attributes.map(({ column }) => `row.${quoted(column)}`).join(", "),
      from:
        `jsonb_array_elements(${param}::jsonb) AS cells, ` +
        `jsonb_populate_record(NULL::${table}, ${jsonObject(pairs)}) AS row`,
    };
  },
};
