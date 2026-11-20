import { Account } from "./src/models/account";
import { FeaturedProduct } from "./src/models/featured-product";
import { Product } from "./src/models/product";
import { ProductCount } from "./src/models/product-count";

export async function building() {
  // #region build
  const lamp = Product.build({ name: "Lamp" });
  console.log(lamp.id); // generated already, before saving: "3b241101-…"
  console.log(lamp.status); // "draft", the column's default
  console.log(lamp.archived); // false, read as a boolean
  console.log(lamp.createdAt); // null until it's saved

  lamp.assign({ status: "published", metadata: { color: "red" } });
  await lamp.save(); // sets createdAt and updatedAt
  // #endregion build
  return lamp;
}

// #region permit
export async function createProduct(request: Request) {
  const permitted = Product.permit(await request.json(), "name", "metadata");
  return Product.create(permitted); // any other key in the body is dropped
}
// #endregion permit

export async function signingUp() {
  // #region virtual
  const form = { email: "jane@example.com", termsOfService: "1" };
  const account = Account.build(Account.permit(form, "email", "termsOfService"));
  console.log(account.termsOfService); // true, cast from the form's "1"
  await account.save(); // inserts the email alone
  // #endregion virtual
  return account;
}

export async function naming() {
  // #region naming
  console.log(FeaturedProduct.modelName); // "FeaturedProduct"
  const published = await FeaturedProduct.where({ status: "published" }).toArray(); // from products
  const account = await Account.create({ email: "jane@example.com" }); // into billing_accounts
  // #endregion naming
  return { published, account };
}

export async function countingByView() {
  // #region view
  const counts = await ProductCount.order({ status: "asc" }).toArray();
  // [ProductCount { status: "draft", total: 1 }, ProductCount { status: "published", total: 2 }]
  // #endregion view
  return counts;
}
