# @forestfuture/active-record

A Rails-inspired Active Record for [Cloudflare Workers](https://developers.cloudflare.com/workers/): Models with validations, callbacks, associations, and change tracking; lazy, composable queries; and a predictable save lifecycle. It talks to a database through an adapter, such as [`@forestfuture/d1-record`](https://www.npmjs.com/package/@forestfuture/d1-record) for [D1](https://developers.cloudflare.com/d1/).

```sh
npm install @forestfuture/active-record @forestfuture/d1-record
```

Generate a Model and its table, then use it in your Worker:

```sh
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

The guide is at [d1-record.forestfuture.dev](https://d1-record.forestfuture.dev). Coming from d1-record 0.5? See [Upgrading to 0.6](https://d1-record.forestfuture.dev/upgrading). The source is on [GitHub](https://github.com/forestfuture/active-record).
