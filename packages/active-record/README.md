# @forestfuture/active-record

A Rails-inspired Active Record for [Cloudflare Workers](https://developers.cloudflare.com/workers/): Models with validations, callbacks, associations, and change tracking; lazy, composable queries; and a predictable save lifecycle. It talks to a database through an adapter it ships with: `@forestfuture/active-record/d1` for [D1](https://developers.cloudflare.com/d1/), and `@forestfuture/active-record/postgresql` for Postgres, with your own `pg`.

```sh
npm install @forestfuture/active-record
```

Name your database, generate a Model and its table, then use it in your Worker:

```sh
npx active-record init
npx active-record g model Post 'title:string!' publishedAt:datetime
npx active-record migrate
```

```ts
import { Post } from "./models/post";

const drafts = await Post.where({ publishedAt: null })
  .order({ createdAt: "desc" })
  .limit(10)
  .toArray();
```

The package also installs the `active-record` command (`ffar` for short), which generates the schema, Models and migrations, applies migrations, and opens a console. It ships the guide for its own version as `llms-full.txt`, and an agent skill in `skills/active-record/`.

The guide is at [active-record.forestfuture.dev](https://active-record.forestfuture.dev). Coming from an earlier release? See [Upgrading](https://active-record.forestfuture.dev/upgrading). The source is on [GitHub](https://github.com/forestfuture/active-record).
