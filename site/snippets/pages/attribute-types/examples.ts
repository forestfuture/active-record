import { Product } from "./src/models/product";

export function building() {
  // #region types
  const lamp = Product.build({
    name: "Lamp",
    price: "12.50",
    weightKg: 1.2,
    stock: 3,
    inStock: true,
    launchesOn: "2026-01-02",
    opensAt: "09:30",
    details: { colors: ["red", "blue"] },
    photo: new Uint8Array([1, 2, 3]),
  });
  console.log(lamp.price); // "12.5"
  console.log(lamp.opensAt); // "09:30:00"
  console.log(lamp.createdAt); // null until it's saved
  // #endregion types
  return lamp;
}

export function casting() {
  // #region casting
  const lamp = Product.build({ name: "Lamp", price: "1.555", stock: 0, inStock: false });
  console.log(lamp.price); // "1.56", rounded to the column's scale of 2

  // Values from JSON, a form or a query string often arrive as text:
  lamp.assign(JSON.parse('{ "stock": " 42 ", "inStock": "true" }'));
  console.log(lamp.stock); // 42
  console.log(lamp.inStock); // true, not the string "true"
  // #endregion casting
  return lamp;
}

export function refusing() {
  // #region refused
  const lamp = Product.build({ name: "Lamp", price: "1", stock: 0, inStock: false });
  lamp.assign(JSON.parse('{ "inStock": "no" }'));
  // TypeError: Product: "no" isn't a boolean for "inStock"
  // #endregion refused
}

// #region bytes
export async function addPhoto(form: FormData) {
  const file = form.get("photo") as File;
  const photo = new Uint8Array(await file.arrayBuffer()); // read before assigning
  return Product.create({ name: file.name, price: "0", stock: 0, inStock: false, photo });
}
// #endregion bytes
