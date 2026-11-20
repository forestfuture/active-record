import { ApplicationRecord } from "./application-record";

export class Product extends ApplicationRecord {
  static {
    this.defaultScope((q) => q.where({ isAvailable: true }));
  }
}
