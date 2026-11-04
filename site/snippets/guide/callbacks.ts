import { abort, Model } from "@forestfuture/active-record";

// #region callbacks
export class Order extends Model.define({
  id: { type: "integer", null: false },
  status: { type: "string", null: false, default: () => "pending" },
  email: { type: "string", null: false },
  totalCents: { type: "integer", null: false },
  suspended: "boolean",
  placedAt: "datetime",
}) {
  static {
    this.beforeValidation((order) => {
      order.email = order.email.trim().toLowerCase();
    });
    this.beforeCreate((order) => {
      order.placedAt = new Date();
    });
    this.beforeSave((order) => {
      if (order.suspended) throw abort("Orders can't change while suspended");
    });
    this.afterSave(async (order) => {
      if (order.hasSavedChangeTo("status", { to: "shipped" })) {
        await notifyShipped(order.email);
      }
    });
  }
}
// #endregion callbacks

async function notifyShipped(email: string): Promise<void> {
  console.log(`shipped: ${email}`);
}
