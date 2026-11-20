import { Article } from "./src/models/article";
import { Invoice } from "./src/models/invoice";
import { Order } from "./src/models/order";
import { User } from "./src/models/user";

export async function placing() {
  // #region callbacks
  const order = await Order.create({
    number: "1001",
    email: " Jane@Example.com ",
    totalCents: 2500,
  });
  console.log(order.email); // "jane@example.com", from the first beforeValidation
  console.log(order.placedAt); // now, from the beforeValidation that runs on create

  await order.update({ status: "shipped" }); // afterSave sends the shipped email
  // #endregion callbacks
  return order;
}

export async function signingUp() {
  // #region commit
  await User.create({ email: "sam@example.com" }); // then afterCreateCommit sends the welcome email
  // #endregion commit
}

export async function touching() {
  // #region touch
  const article = await Article.findByOrThrow({ title: "Hello" });
  await article.touch(); // sets updatedAt, then afterTouch purges the cached page
  // #endregion touch
  return article;
}

export async function refusing() {
  // #region rollback
  const order = Order.build({ number: "1001", email: "sam@example.com", totalCents: 900 });
  await order.save(); // throws RecordNotUnique, once afterRollback has logged "Order 1001 wasn't saved"
  // #endregion rollback
}

export async function building() {
  // #region initialize
  const invoice = Invoice.build({ country: "GB" });
  console.log(invoice.currency); // "GBP", from afterInitialize
  // #endregion initialize
  return invoice;
}

export async function loadingPartly() {
  // #region partial
  const invoices = await Invoice.select("id", "country").toArray(); // afterFind skips the total
  const large = await Invoice.where({ country: "US" }).toArray(); // afterFind logs the large one
  // #endregion partial
  return { invoices, large };
}

export async function stopping() {
  // #region abort
  const order = await Order.findByOrThrow({ number: "1002" }); // a suspended order
  order.totalCents = 0;
  await order.save(); // false, and nothing is written
  console.log(order.abortReason); // "Orders can't change while suspended"
  // #endregion abort
  return order;
}
