import { ApplicationRecord } from "./application-record";

// #region declare
export class Product extends ApplicationRecord {
  static {
    this.defaultScope((q) => q.where({ available: 1 }));
  }
}
// #endregion declare

export async function examples() {
  // #region queries
  const listed = await Product.order({ name: "asc" }).toArray(); // available products only
  const draft = Product.build({ name: "Pen" }); // available: 1, from the default scope
  // #endregion queries

  // #region unscoped
  const everything = await Product.unscoped().toArray(); // available or not
  // #endregion unscoped
  return { listed, draft, everything };
}
