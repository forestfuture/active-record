// SQLite's SQL, which is D1's.
import { type Dialect, valueMark } from "@forestfuture/active-record/adapter";

export const sqlite: Dialect = {
  placeholder: () => "?",
  inList: (column, cells) => ({
    sql: `${column} IN (SELECT value FROM json_each(${valueMark}))`,
    value: JSON.stringify(cells),
  }),
  pagination(limit, offset, params) {
    // SQLite only accepts OFFSET after a LIMIT; -1 means "no limit".
    params.push(limit ?? -1);
    if (offset === undefined) return ` LIMIT ${valueMark}`;
    params.push(offset);
    return ` LIMIT ${valueMark} OFFSET ${valueMark}`;
  },
  bulkRows: (_table, attributes) => ({
    select: attributes.map((_, index) => `value ->> '$[${index}]'`).join(", "),
    from: `json_each(${valueMark})`,
  }),
  // A key that isn't text, selected for a text attribute, is cast to text: SQLite would compare
  // them by number, which can't search the attribute's index, and which '09' matches.
  linkedKey: (key, keyAttribute, linked) =>
    linked.isText && !keyAttribute.isText ? `CAST(${key} AS TEXT)` : key,
};
