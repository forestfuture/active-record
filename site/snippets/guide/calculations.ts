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
  const withTax = await Product.sum(sql`${column("priceCents")} * ${1.2}`); // a number
  // #endregion fragment

  return { total, averagePrice, cheapest, newest, topThree, withTax };
}
