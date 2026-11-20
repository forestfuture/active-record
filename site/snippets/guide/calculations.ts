import { column, Model, sql } from "@forestfuture/active-record";

// #region model
export class Product extends Model.define({
  id: { type: "string", null: false, generateId: true },
  name: { type: "string", null: false },
  priceCents: { type: "integer", null: false },
  isAvailable: { type: "boolean", null: false },
  createdAt: { type: "datetime", null: false },
  updatedAt: { type: "datetime", null: false },
}) {}
// #endregion model

export async function calculations() {
  // #region calculations
  const total = await Product.where({ isAvailable: true }).sum("priceCents"); // 0 with no products
  const averagePrice = await Product.average("priceCents"); // a number, or null
  const cheapest = await Product.minimum("priceCents"); // or null
  const newest = await Product.maximum("createdAt"); // a Date, or null
  // #endregion calculations

  // #region limit
  const mostExpensive = Product.order({ priceCents: "desc" }).limit(3);
  const topThree = await mostExpensive.sum("priceCents"); // only those three
  // #endregion limit

  // #region fragment
  const inDollars = sql`${column("priceCents")} / 100.0`;
  const averageDollars = await Product.average(inDollars); // a number, or null
  // #endregion fragment

  return { total, averagePrice, cheapest, newest, topThree, averageDollars };
}

export async function groups() {
  // #region group
  const byAvailability = await Product.group("isAvailable").count(); // Map { true => 3, false => 1 }
  const inStock = byAvailability.get(true); // 3
  const valueByAvailability = await Product.group("isAvailable").sum("priceCents");
  // #endregion group

  // #region group-fragment
  const band = sql`CASE WHEN ${column("priceCents")} >= ${10_000} THEN 'pricey' ELSE 'cheap' END`;
  const byBand = await Product.group("isAvailable", band).count(); // Map { [true, "cheap"] => 2, … }
  // #endregion group-fragment

  // #region having
  const crowded = Product.group("isAvailable").having(sql`COUNT(*) > ${1}`);
  const crowdedCounts = await crowded.count(); // Map { true => 3 }
  // #endregion having

  // #region group-order
  const largestFirst = Product.group("isAvailable").order(sql`COUNT(*) DESC`);
  const largest = await largestFirst.limit(1).count(); // Map { true => 3 }
  // #endregion group-order

  return { byAvailability, inStock, valueByAvailability, byBand, crowdedCounts, largest };
}
