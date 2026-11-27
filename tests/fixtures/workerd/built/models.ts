// The built-package fixture Worker's Models: plain classes on an ApplicationRecord, as an app declares them.
import { belongsTo, hasMany, Model } from "@forestfuture/arbor";
import { schema } from "./schema";

abstract class ApplicationRecord extends Model {
  static override schema = schema;
}

export class Product extends ApplicationRecord {
  reviews = hasMany(Review);
}

export class Review extends ApplicationRecord {
  product = belongsTo(Product);
}
