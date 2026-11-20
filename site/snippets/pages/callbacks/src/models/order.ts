import { abort } from "@forestfuture/active-record";
import { sendShippedEmail } from "../mail";
import { ApplicationRecord } from "./application-record";

export class Order extends ApplicationRecord {
  static {
    this.beforeValidation((order) => {
      order.email = order.email.trim().toLowerCase();
    });
    this.beforeValidation(
      (order) => {
        order.placedAt = new Date();
      },
      { on: "create" },
    );
    this.beforeSave((order) => {
      if (order.isSuspended) throw abort("Orders can't change while suspended");
    });
    this.aroundSave(async (order, next) => {
      const started = Date.now();
      await next();
      console.log(`Saved order ${order.number} in ${Date.now() - started} ms`);
    });
    this.afterSave(async (order) => {
      if (order.hasSavedChangeTo("status", { to: "shipped" })) {
        await sendShippedEmail(order.email);
      }
    });
    this.afterRollback((order) => {
      console.log(`Order ${order.number} wasn't saved`);
    });
  }
}
