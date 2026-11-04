// SQLite's SQL, which is D1's.
import type { Dialect } from "@forestfuture/active-record/adapter";

export const sqlite: Dialect = {
  inList: (column, cells) => ({
    sql: `${column} IN (SELECT value FROM json_each(?))`,
    value: JSON.stringify(cells),
  }),
  pagination(limit, offset, params) {
    // SQLite only accepts OFFSET after a LIMIT; -1 means "no limit".
    params.push(limit ?? -1);
    if (offset === undefined) return " LIMIT ?";
    params.push(offset);
    return " LIMIT ? OFFSET ?";
  },
  bulkRows: (attributes) => ({
    select: attributes.map((_, index) => `value ->> '$[${index}]'`).join(", "),
    from: "json_each(?)",
  }),
};
