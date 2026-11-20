import { gte } from "@forestfuture/active-record";
import { Product } from "./src/models/product";
import { Shirt } from "./src/models/shirt";
import { Money } from "./src/types/money";

export function refusing() {
  // #region refuse
  Product.permit({ priceCents: "abc" }, "priceCents");
  // TypeError: Product: "abc" isn't a valid value for "priceCents"
  // #endregion refuse
}

export async function pricing() {
  // #region query
  const cheap = await Product.where({ priceCents: new Money(500) }).toArray();
  const pricey = await Product.where({ priceCents: gte(new Money(10_000)) })
    .order({ priceCents: "desc" })
    .toArray();
  // #endregion query
  return { cheap, pricey };
}

export async function addingSize() {
  // #region in-place
  const shirt = await Shirt.findByOrThrow({ name: "Oxford" }); // sizes: ["S", "M"]
  shirt.sizes.push("XL");
  console.log(shirt.isChanged()); // true
  await shirt.save(); // writes "S,M,XL"
  // #endregion in-place
  return shirt;
}
