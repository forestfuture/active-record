// As `active-record schema` generates it for a second binding, LOGS, for the guide's examples.
import type { TableAttributes } from "@forestfuture/active-record";
import { d1 } from "@forestfuture/active-record/d1";

/** entries */
export const entries = {
  id: { type: "integer", null: false },
  level: { type: "string", null: false },
  message: { type: "string", null: false },
} as const;

/** The database's adapter and binding, its tables (with their primary keys), and the Models built on them. */
export const schema = {
  adapter: d1({ binding: "LOGS" }),
  tables: {
    entries: { attributes: entries, primaryKey: "id" },
  },
  models: { Entry: "entries" },
} as const;

declare module "../guide/several-databases" {
  interface Entry extends TableAttributes<typeof entries, (typeof Entry)["attributes"]> {}
}
