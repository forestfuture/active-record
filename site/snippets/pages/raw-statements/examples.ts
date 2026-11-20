import { Invoice } from "./src/models/invoice";

// #region bind
export async function paidSince(db: D1Database, since: Date) {
  const { serialize } = Invoice.typeForAttribute("paidAt");
  const { results } = await db
    .prepare("SELECT id, total FROM invoices WHERE paid_at >= ?")
    .bind(serialize(since)) // an integer, as paid_at holds it
    .all<{ id: number; total: number }>();
  return results;
}
// #endregion bind

// #region read
export async function paidAt(db: D1Database, id: number) {
  const { deserialize } = Invoice.typeForAttribute("paidAt");
  const row = await db
    .prepare("SELECT paid_at FROM invoices WHERE id = ?")
    .bind(id)
    .first<{ paid_at: number | null }>();
  return deserialize(row?.paid_at); // a Date, or null
}
// #endregion read
