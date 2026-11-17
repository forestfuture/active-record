import { column, sql } from "@forestfuture/active-record";
import { Product } from "./models";

export async function calculations(): Promise<unknown> {
  // #region calculations
  const total = await Product.where({ available: 1 }).sum("priceCents"); // 0 with no products
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

export async function groups(): Promise<unknown> {
  // #region group
  const byAvailability = await Product.group("available").count(); // Map { 1 => 3, 0 => 1 }
  const inStock = byAvailability.get(1); // 3
  const valueByAvailability = await Product.group("available").sum("priceCents");
  // #endregion group

  // #region group-fragment
  const band = sql`CASE WHEN ${column("priceCents")} >= ${10_000} THEN 'pricey' ELSE 'cheap' END`;
  const byBand = await Product.group("available", band).count(); // Map { [1, "cheap"] => 2, … }
  // #endregion group-fragment

  // #region having
  const crowded = Product.group("available").having(sql`COUNT(*) > ${1}`);
  const crowdedCounts = await crowded.count(); // Map { 1 => 3 }
  // #endregion having

  // #region group-order
  const largestFirst = Product.group("available").order(sql`COUNT(*) DESC`);
  const largest = await largestFirst.limit(1).count(); // Map { 1 => 3 }
  // #endregion group-order

  return { byAvailability, inStock, valueByAvailability, byBand, crowdedCounts, largest };
}
