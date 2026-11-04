import { Model } from "@forestfuture/active-record";

export class Invoice extends Model.define({
  id: { type: "integer", null: false },
  total: { type: "integer", null: false },
  paidAt: { type: "datetime", storage: "unixSeconds" },
}) {}

// #region bind
export async function paidSince(db: D1Database, since: Date) {
  const { serialize } = Invoice.typeForAttribute("paidAt");
  const { results } = await db
    .prepare("SELECT id, total FROM invoices WHERE paid_at >= ?")
    .bind(serialize(since))
    .all<{ id: number; total: number }>();
  return results;
}
// #endregion bind

// #region read
export async function paidAt(db: D1Database, id: number): Promise<Date | null> {
  const { deserialize } = Invoice.typeForAttribute("paidAt");
  const row = await db
    .prepare("SELECT paid_at FROM invoices WHERE id = ?")
    .bind(id)
    .first<{ paid_at: number | null }>();
  return deserialize(row?.paid_at);
}
// #endregion read
