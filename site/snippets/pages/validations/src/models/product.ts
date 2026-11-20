import { ApplicationRecord } from "./application-record";

export class Product extends ApplicationRecord {
  static {
    this.errorMessages({
      greaterThan: "must be more than %{count}",
      attributes: {
        name: { blank: "needs a name customers will see" },
      },
    });
    this.humanAttributeNames({ priceCents: "Price" });

    this.validates("name", { presence: true, length: { minimum: 3 } });
    this.validates("priceCents", { numericality: { greaterThan: 0 } });
  }
}
