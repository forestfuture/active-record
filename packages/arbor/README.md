# Arbor ORM

`@forestfuture/arbor` is Arbor, an Active Record ORM for TypeScript on [Cloudflare D1](https://developers.cloudflare.com/d1/) and PostgreSQL, built for [Cloudflare Workers](https://developers.cloudflare.com/workers/): Models with validations, callbacks, associations, and change tracking; lazy, composable queries; and a predictable save lifecycle. It talks to a database through an adapter it ships with: `@forestfuture/arbor/d1` for [D1](https://developers.cloudflare.com/d1/), and `@forestfuture/arbor/postgresql` for Postgres, with your own `pg`.

```sh
npm install @forestfuture/arbor
```

Name your database, generate a Model and its table, then use it in your Worker:

```sh
npx arbor init
npx arbor g model Post 'title:string!' publishedAt:datetime
npx arbor migrate
```

```ts
import { Post } from "./models/post";

const drafts = await Post.where({ publishedAt: null })
  .order({ createdAt: "desc" })
  .limit(10)
  .toArray();
```

The package also installs the `arbor` command, which generates the schema, Models and migrations, applies migrations, and opens a console. It ships the guide for its own version as `llms-full.txt`, and an agent skill in `skills/arbor/`.

The guide is at [arbor.forestfuture.dev](https://arbor.forestfuture.dev). Coming from an earlier release? See [Upgrading](https://arbor.forestfuture.dev/upgrading). The source is on [GitHub](https://github.com/forestfuture/arbor).
