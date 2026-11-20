import { ApplicationRecord } from "./application-record";

// A view, which migrations don't describe, so the Model declares its attributes itself:
export class ProductCount extends ApplicationRecord.define({
  status: { type: "string", null: false },
  total: { type: "integer", null: false },
}) {
  static override table = "product_counts";
  static override primaryKey = "status";
}
