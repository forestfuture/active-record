import { Post } from "./src/models/post";
import { Product } from "./src/models/product";

export async function calling() {
  // #region scopes
  const published = await Post.published().toArray();
  const thisYear = await Post.published().publishedSince(new Date("2026-01-01")).toArray();
  const hellos = await Post.where({ title: "Hello" }).published().count(); // on any Relation
  // #endregion scopes
  return { published, thisYear, hellos };
}

export async function defaulting() {
  // #region default-scope
  const listed = await Product.order({ name: "asc" }).toArray(); // available products only
  const draft = Product.build({ name: "Pen" }); // isAvailable: true, from the default scope
  // #endregion default-scope
  return { listed, draft };
}

export async function unscoping() {
  // #region unscoped
  const everything = await Product.unscoped().toArray(); // available or not
  // #endregion unscoped
  return everything;
}
