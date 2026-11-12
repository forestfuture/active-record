import { belongsTo, hasMany, Model } from "@forestfuture/active-record";
import { schema } from "../db/schema";

// The app's base class, holding the generated schema with the categories table
// (site/snippets/db/schema.ts).
abstract class ApplicationRecord extends Model {
  static override schema = schema;
}

// #region self-reference
export class Category extends ApplicationRecord {
  // foreign key: parentId, from the association's name; optional, since a top-level category has none
  parent = belongsTo(Category, { optional: true });
  children = hasMany(Category, { foreignKey: "parentId" }); // not the default, categoryId
}
// #endregion self-reference
