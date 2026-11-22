// SQLite's SQL, which is D1's.
import { type Dialect, hexOf, valueMark } from "@forestfuture/active-record/adapter";

/** A binary attribute's cells, each bytes, as hex text: what JSON can hold. */
function hexCells(cells: readonly unknown[]): (string | null)[] {
  return (cells as readonly (Uint8Array | null)[]).map((cell) =>
    cell === null ? null : hexOf(cell),
  );
}

/** A list's cells bound as one JSON value, and how a `json_each` row reads one back (#20). */
function jsonList(cells: readonly unknown[], isBinary: boolean): { value: string; cell: string } {
  return {
    value: JSON.stringify(isBinary ? hexCells(cells) : cells),
    cell: isBinary ? "unhex(value)" : "value",
  };
}

export const sqlite: Dialect = {
  placeholder: () => "?",
  // JSON has no bytes, so a list of them is bound as hex text, read back with unhex (#20).
  inList(column, cells, { isBinary }) {
    const { value, cell } = jsonList(cells, isBinary);
    return { sql: `${column} IN (SELECT ${cell} FROM json_each(${valueMark}))`, value };
  },
  // `IS` matches a NULL in the list too; the first place a value has is its own.
  placeInList(column, cells, { isBinary }) {
    const { value, cell } = jsonList(cells, isBinary);
    return {
      sql: `(SELECT MIN(key) FROM json_each(${valueMark}) WHERE ${cell} IS ${column})`,
      value,
    };
  },
  pagination(limit, offset, params) {
    // SQLite only accepts OFFSET after a LIMIT; -1 means "no limit".
    params.push(limit ?? -1);
    if (offset === undefined) return ` LIMIT ${valueMark}`;
    params.push(offset);
    return ` LIMIT ${valueMark} OFFSET ${valueMark}`;
  },
  bulkRows: (_table, attributes) => ({
    select: attributes
      .map(({ isBinary }, index) => {
        const cell = `value ->> '$[${index}]'`;
        // Bytes are hex text in the JSON (#20).
        return isBinary ? `unhex(${cell})` : cell;
      })
      .join(", "),
    from: `json_each(${valueMark})`,
  }),
  // D1 caps a string or BLOB at 2,000,000 bytes, a bound one too (#392).
  maxValueBytes: 2_000_000,
  // `changes()` is the write's, sent just before it in the batch. A JSON path that isn't one
  // fails the batch, and D1's message repeats it (#357).
  staleGuard: (write, marker) => [
    write,
    {
      sql: `SELECT json_extract('{}', CASE WHEN changes() = 0 THEN ${valueMark} ELSE '$' END) AS stale`,
      params: [marker],
      model: write.model,
    },
  ],
  // A key that isn't text, selected for a text attribute, is cast to text: SQLite would compare
  // them by number, which can't search the attribute's index, and which '09' matches.
  linkedKey: (key, keyAttribute, linked) =>
    linked.isText && !keyAttribute.isText ? `CAST(${key} AS TEXT)` : key,
};
