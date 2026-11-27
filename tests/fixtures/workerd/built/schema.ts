// The built-package fixture Worker's schema, written as `arbor schema` writes an app's: its tables, and the Models' attributes typed from them.
import { defineSchema, type TableAttributes } from "@forestfuture/arbor";
import { d1 } from "@forestfuture/arbor/d1";

export const products = {
  id: { type: "integer", null: false },
  title: { type: "string", null: false },
} as const;

export const reviews = {
  id: { type: "integer", null: false },
  productId: { type: "integer", null: false },
  body: { type: "string", null: false },
} as const;

// Each Model finds its table by its class name, so a bundle that renamed the classes breaks it.
export const schema = defineSchema({
  adapter: d1({ binding: "DB" }),
  tables: {
    products: { attributes: products, primaryKey: "id" },
    reviews: { attributes: reviews, primaryKey: "id" },
  },
  models: { Product: "products", Review: "reviews" },
});

declare module "./models" {
  interface Product extends TableAttributes<typeof products, (typeof Product)["attributes"]> {}
  interface Review extends TableAttributes<typeof reviews, (typeof Review)["attributes"]> {}
}
