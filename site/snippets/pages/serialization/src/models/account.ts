import { hasMany } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { Order } from "./order";

export class Account extends ApplicationRecord {
  // A Model's list replaces the base class's, so repeat what you still want hidden:
  static override hiddenAttributes = [...ApplicationRecord.hiddenAttributes, "apiKey"];

  orders = hasMany(Order);

  get domain(): string {
    return this.email.split("@")[1] ?? "";
  }
}
