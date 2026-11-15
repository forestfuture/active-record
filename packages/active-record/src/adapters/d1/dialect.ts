// SQLite's SQL, which is D1's.
import { type Dialect, hexOf, valueMark } from "@forestfuture/active-record/adapter";

export const sqlite: Dialect = {
  placeholder: () => "?",
  // JSON has no bytes, so a list of them is bound as hex text, read back with unhex (#20).
  inList: (column, cells, { isBinary }) => ({
    sql: `${column} IN (SELECT ${isBinary ? "unhex(value)" : "value"} FROM json_each(${valueMark}))`,
    value: JSON.stringify(isBinary ? cells.map((cell) => hexOf(cell as Uint8Array)) : cells),
  }),
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
  // A key that isn't text, selected for a text attribute, is cast to text: SQLite would compare
  // them by number, which can't search the attribute's index, and which '09' matches.
  linkedKey: (key, keyAttribute, linked) =>
    linked.isText && !keyAttribute.isText ? `CAST(${key} AS TEXT)` : key,
};
