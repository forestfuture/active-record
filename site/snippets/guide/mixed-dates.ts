import { column, Model, sql } from "@forestfuture/active-record";

export class Reminder extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  createdAt: { type: "datetime", null: false },
}) {}

// #region recipe
export function createdSince(since: Date) {
  const createdAt = column("createdAt");
  return Reminder.where(
    sql`strftime('%Y-%m-%dT%H:%M:%fZ', ${createdAt}) >= ${createdAt.value(since)}`,
  );
}

export function oldestFirst() {
  const createdAt = column("createdAt");
  return Reminder.order(sql`strftime('%Y-%m-%dT%H:%M:%fZ', ${createdAt})`);
}
// #endregion recipe
