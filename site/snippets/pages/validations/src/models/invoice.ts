import { ApplicationRecord } from "./application-record";

export class Invoice extends ApplicationRecord {
  static {
    this.validates("currency", { inclusion: ["USD", "EUR"], strict: true }); // throws, not collects
  }
}
