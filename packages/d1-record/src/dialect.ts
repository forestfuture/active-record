// SQLite's SQL, which is D1's.
import { type Dialect, param } from "@forestfuture/active-record/adapter";

export const sqlite: Dialect = {
  placeholder: () => "?",
  inList: (column, cells) => ({
    sql: `${column} IN (SELECT value FROM json_each(${param}))`,
    value: JSON.stringify(cells),
  }),
  pagination(limit, offset, params) {
    // SQLite only accepts OFFSET after a LIMIT; -1 means "no limit".
    params.push(limit ?? -1);
    if (offset === undefined) return ` LIMIT ${param}`;
    params.push(offset);
    return ` LIMIT ${param} OFFSET ${param}`;
  },
  bulkRows: (_table, attributes) => ({
    select: attributes.map((_, index) => `value ->> '$[${index}]'`).join(", "),
    from: `json_each(${param})`,
  }),
};
