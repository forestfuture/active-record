// As `d1-record schema` generates it, for the guide's examples (their Models are declared in
// several files, so it's kept by hand rather than generated).
import type { TableAttributes } from "@forestfuture/active-record";
import { d1 } from "@forestfuture/d1-record";

/** billing_accounts */
export const billingAccounts = {
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  updatedBy: "string",
} as const;

/** products */
export const products = {
  id: { type: "string", null: false, generateId: true },
  name: { type: "string", null: false },
  priceCents: { type: "integer", null: false, default: () => 0 },
  available: { type: "integer", null: false, default: () => 1 },
  internalNotes: "string",
  createdAt: { type: "datetime", null: false },
  updatedAt: { type: "datetime", null: false },
} as const;

/** posts: a Drizzle app's, plain TEXT and INTEGER columns */
export const posts = {
  id: { type: "string", null: false, generateId: true },
  title: { type: "string", null: false },
  metadata: "string",
  archived: "integer",
  legacyNotes: "string",
  publishedAt: "integer",
} as const;

/** articles: columns from Drizzle's integer({ mode: "timestamp" }) and "timestamp_ms" */
export const articles = {
  id: { type: "string", null: false, generateId: true },
  publishedAt: "integer",
  updatedAt: "integer",
} as const;

/** categories */
export const categories = {
  id: { type: "string", null: false, generateId: true },
  parentId: "string",
  name: { type: "string", null: false },
} as const;

/** users */
export const users = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
} as const;

/** The database's adapter and binding, its tables (with their primary keys), and the Models built on them. */
export const schema = {
  adapter: d1({ binding: "DB" }),
  tables: {
    billing_accounts: { attributes: billingAccounts, primaryKey: "id" },
    products: { attributes: products, primaryKey: "id" },
    posts: { attributes: posts, primaryKey: "id" },
    articles: { attributes: articles, primaryKey: "id" },
    categories: { attributes: categories, primaryKey: "id" },
    users: { attributes: users, primaryKey: "id" },
  },
  models: {
    Account: "billing_accounts",
    Article: "articles",
    Category: "categories",
    Post: "posts",
    Product: "products",
    User: "users",
  },
} as const;

declare module "../guide/adopt" {
  interface Article extends TableAttributes<typeof articles, (typeof Article)["attributes"]> {}
  interface Post extends TableAttributes<typeof posts, (typeof Post)["attributes"]> {}
}

declare module "../guide/application-record" {
  interface Account extends TableAttributes<
    typeof billingAccounts,
    (typeof Account)["attributes"]
  > {}
}

declare module "../guide/coming-from-rails" {
  interface Product extends TableAttributes<typeof products, (typeof Product)["attributes"]> {}
}

declare module "../guide/error-messages" {
  interface Product extends TableAttributes<typeof products, (typeof Product)["attributes"]> {}
}

declare module "../guide/generators" {
  interface Category extends TableAttributes<typeof categories, (typeof Category)["attributes"]> {}
}

declare module "../guide/models" {
  interface Product extends TableAttributes<typeof products, (typeof Product)["attributes"]> {}
}

declare module "../guide/several-databases" {
  interface User extends TableAttributes<typeof users, (typeof User)["attributes"]> {}
}

declare module "../guide/overrides" {
  interface Product extends TableAttributes<typeof products, (typeof Product)["attributes"]> {}
}
