import { belongsTo, hasMany, type HasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";

export class Category extends ApplicationRecord {
  static top = this.scope((q) => q.where({ parentId: null }));
  static alphabetical = this.scope((q) => q.order({ name: "asc" }));

  parent = belongsTo(Category, { foreignKey: "parentId", optional: true }); // a top category has none

  // Written out: TypeScript can't infer a field whose scope uses its own Model's scopes.
  children: HasMany<typeof Category> = hasMany(Category, {
    foreignKey: "parentId",
    scope: (q) => q.alphabetical(),
  });
}
