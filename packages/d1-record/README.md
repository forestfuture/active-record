# @forestfuture/d1-record

The [Cloudflare D1](https://developers.cloudflare.com/d1/) adapter for [`@forestfuture/active-record`](https://www.npmjs.com/package/@forestfuture/active-record). Install both:

```sh
npm install @forestfuture/active-record @forestfuture/d1-record
```

Models query their D1 binding with no setup. Open a database yourself with `connect`, for a Session or for logging one request’s queries:

```ts
import { connect } from "@forestfuture/d1-record";

const db = connect(env.DB, { onQuery: ({ sql, durationMs }) => console.log(durationMs, sql) });
```

It provides `connect`, `withSession` (a request’s D1 Session, carried between requests by its bookmark), `NoSession`, `d1` (what a generated schema names), and the `active-record` command's D1 plugin, which reads your Wrangler config and applies migrations through Wrangler.

On D1, a preload with `includes` sends its whole tree in one round trip with the records’ own query, and `paginate` sends its count and its page together.

The guide is at [active-record.forestfuture.dev](https://active-record.forestfuture.dev), and the source is on [GitHub](https://github.com/forestfuture/active-record).
