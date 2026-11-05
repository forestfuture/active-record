# @forestfuture/d1-record

The [Cloudflare D1](https://developers.cloudflare.com/d1/) adapter for [`@forestfuture/active-record`](https://www.npmjs.com/package/@forestfuture/active-record). Install both:

```sh
npm install @forestfuture/active-record @forestfuture/d1-record
```

Models query their D1 binding with no setup. To open a database yourself, for a Session or per-request logging, use `connect`:

```ts
import { connect, withSession } from "@forestfuture/d1-record";

const db = connect(env.DB, { onQuery: ({ sql, durationMs }) => console.log(durationMs, sql) });
```

It provides `connect`, `withSession` (a request's D1 Session, carried between requests by its bookmark), `NoSession`, `d1` (what a generated schema names), and the `active-record` command's D1 plugin, which reads your Wrangler config and applies migrations through Wrangler.

The guide is at [d1-record.forestfuture.dev](https://d1-record.forestfuture.dev), and the source is on [GitHub](https://github.com/forestfuture/d1-record).
