// As `active-record schema` generates it, for the guide's examples (their Models are declared in
// several files, so it's kept by hand rather than generated).
import { defineSchema, type ScopeStatic, type TableAttributes } from "@forestfuture/active-record";
import { d1 } from "@forestfuture/active-record/d1";

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

/** tickets */
export const tickets = {
  id: { type: "string", null: false, generateId: true },
  status: "string",
  priority: "integer",
} as const;

// #region generated-enum
/** tasks — state TEXT NOT NULL CHECK (state IN ('open', 'done')) */
export const tasks = {
  id: { type: "string", null: false, generateId: true },
  state: {
    type: "string",
    null: false,
    enum: ["open", "done"],
    scopes: false,
    instanceMethods: false,
  },
} as const;
// #endregion generated-enum

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
export const schema = defineSchema({
  adapter: d1({ binding: "DB" }),
  tables: {
    billing_accounts: { attributes: billingAccounts, primaryKey: "id" },
    products: { attributes: products, primaryKey: "id" },
    posts: { attributes: posts, primaryKey: "id" },
    articles: { attributes: articles, primaryKey: "id" },
    tickets: { attributes: tickets, primaryKey: "id" },
    tasks: { attributes: tasks, primaryKey: "id" },
    categories: { attributes: categories, primaryKey: "id" },
    users: { attributes: users, primaryKey: "id" },
  },
  models: {
    Account: "billing_accounts",
    Article: "articles",
    Category: "categories",
    Post: "posts",
    Product: "products",
    Task: "tasks",
    Ticket: "tickets",
    User: "users",
  },
  enumScopes: {
    Task: ["open", "notOpen", "done", "notDone"],
    Ticket: [
      "open",
      "notOpen",
      "inProgress",
      "notInProgress",
      "closed",
      "notClosed",
      "low",
      "notLow",
      "normal",
      "notNormal",
      "high",
      "notHigh",
    ],
  },
});

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

declare module "../guide/custom-types" {
  interface Product extends TableAttributes<typeof products, (typeof Product)["attributes"]> {}
}

declare module "../guide/overrides" {
  interface Product extends TableAttributes<typeof products, (typeof Product)["attributes"]> {}
}

declare module "../guide/enums" {
  interface Ticket extends TableAttributes<typeof tickets, (typeof Ticket)["attributes"]> {}
  namespace Ticket {
    export const open: ScopeStatic<[]>;
    export const notOpen: ScopeStatic<[]>;
    export const inProgress: ScopeStatic<[]>;
    export const notInProgress: ScopeStatic<[]>;
    export const closed: ScopeStatic<[]>;
    export const notClosed: ScopeStatic<[]>;
    export const low: ScopeStatic<[]>;
    export const notLow: ScopeStatic<[]>;
    export const normal: ScopeStatic<[]>;
    export const notNormal: ScopeStatic<[]>;
    export const high: ScopeStatic<[]>;
    export const notHigh: ScopeStatic<[]>;
  }
  interface Task extends TableAttributes<typeof tasks, (typeof Task)["attributes"]> {}
  namespace Task {
    export const open: ScopeStatic<[]>;
    export const notOpen: ScopeStatic<[]>;
    export const done: ScopeStatic<[]>;
    export const notDone: ScopeStatic<[]>;
  }
}
