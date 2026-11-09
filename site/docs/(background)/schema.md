---
title: Schema and ApplicationRecord
description: "Why Active Record generates a Model's attributes from your migrations and Model files, how the generated schema compares to Rails' schema.rb, and how a Model extending ApplicationRecord gets its table's attributes."
---

In Rails, a migration describes a table, and the model never repeats it: Rails reads the columns from the database when the app runs. Active Record keeps that idea, with one change TypeScript requires: it reads the columns when you **generate** the schema, not when your Worker runs.

## Migrations are the source of truth

Tables are created and changed by **migrations**: numbered SQL files that Wrangler applies in order, recording each one in the database (in a `d1_migrations` table), so each runs once. Cloudflare’s [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) guide covers Wrangler’s side. Active Record’s generators write migrations for you, but any migration Wrangler can apply works, however it was written.

A Model never redeclares its columns. If it did, the migration and the Model would say the same thing twice (`price_cents INTEGER NOT NULL`, then `priceCents: { type: "integer", null: false }`), and could drift apart.

## The generated schema

TypeScript needs to know a Model’s attributes before your code runs, to type `product.priceCents` and check `Product.where({ … })`. And a Worker shouldn’t ask D1 for its tables on every request. So instead of reading the database at runtime, `active-record schema` applies your migrations to an in-memory SQLite database, reads each table’s columns, and writes them to `src/db/schema.ts`.

That file is to Active Record what `db/schema.rb` is to Rails: a document of every table, regenerated after each migration, never edited by hand, and committed, so each schema change shows up as a readable diff next to its migration. Each table names the migration that last changed it. In CI, `active-record schema --check` catches a schema someone forgot to regenerate.

After the tables, the file holds `schema`: the D1 binding, every table, and the list of your Models. Last come type declarations that add each table’s attributes to its Model’s class. They’re types only, so the file still imports nothing when your Worker runs.

Columns become attributes by convention, as Rails’ do: the column’s declared type first (`INTEGER` is an `integer`, `DATETIME` a `datetime`), then, for plain `TEXT` and `INTEGER` columns, its name (`created_at` is a `datetime`). The [Command line](./command-line#mapping-columns-to-attributes) reference lists every rule. When a column’s type isn’t what your app means (JSON in a plain `TEXT` column, say), an override in the Model says so, without touching the table.

## How a Model gets its attributes

A Model extends your app’s base class, with nothing else on the `extends` line:

```ts
import { ApplicationRecord } from "./application-record";

export class Product extends ApplicationRecord {}
```

TypeScript can’t give a class types from its name. So `active-record schema` loads your Model files, finds `Product`, and writes a declaration giving the `Product` class the `products` table’s attributes. That’s why the schema is generated from your Models as well as your migrations, and why it changes when you add or rename a Model.

When your Worker runs, `Product` finds its attributes the first time it’s used. Its table comes from its class name, and the table’s attributes from the schema that `ApplicationRecord` holds. A Model missing from the schema’s list throws `InvalidModel`, telling you to run `active-record schema`. Without that check, a development server, which doesn’t type-check, would run a Model whose types were never generated.

`ApplicationRecord` itself is a file in your app, `src/models/application-record.ts`, which `active-record schema` writes once. It’s an abstract class that holds the generated schema, and it’s where behavior shared by every Model goes. See [Shared behavior](./shared-behavior).

A Model can still declare its attributes itself, with `define`, for a view or a table your migrations don’t make. See [Models](./models#declaring-attributes-yourself).
