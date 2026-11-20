import { Invoice } from "./src/models/invoice";
import { Product } from "./src/models/product";

export async function sharing() {
  // #region shared
  const lamp = await Product.create({ name: "Lamp" }); // logs "Saving Product"
  console.log(lamp.label()); // Product {"id":"…","name":"Lamp","createdAt":"…"}
  const newest = await Product.newest().first(); // the shared scope, on products
  // #endregion shared
  return { lamp, newest };
}

export async function auditing() {
  // #region some
  await Invoice.create({ totalCents: 1200 }); // logs "Saving Invoice", then "Saved Invoice"
  // #endregion some
}
