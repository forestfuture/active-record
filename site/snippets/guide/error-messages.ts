import { Model } from "@forestfuture/active-record";
import { schema } from "../db/schema";

// #region base
// src/models/application-record.ts
export abstract class ApplicationRecord extends Model {
  static override schema = schema;

  static {
    this.errorMessages({
      blank: "is required",
      tooShort: {
        one: "needs at least 1 character",
        other: "needs at least %{count} characters",
      },
    });
    this.humanAttributeNames({ createdAt: "Added on" });
  }
}
// #endregion base

// #region model
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
// #endregion model

export async function messagesExample() {
  // #region read
  const product = Product.build({ name: "", priceCents: 0 });
  await product.isValid(); // false

  product.errors.fullMessages();
  // ["Name needs a name customers will see",
  //  "Name needs at least 3 characters",
  //  "Price must be more than 0"]
  Product.humanAttributeName("priceCents"); // "Price"
  // #endregion read
  return product;
}
