# @forestfuture/pg-record

The Postgres adapter for [`@forestfuture/active-record`](https://www.npmjs.com/package/@forestfuture/active-record), on Cloudflare Workers through [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) and on Node. It isn’t on npm yet: it’s released once the `active-record` command can generate its schema and apply its migrations.

Open a database from a Hyperdrive binding, a connection string, or your own `pg` Pool:

```ts
import { withDatabase } from "@forestfuture/active-record";
import { connect } from "@forestfuture/pg-record";

const db = connect(env.HYPERDRIVE);
await withDatabase(db, () => app.fetch(request, env));
```

It provides `connect`, `Database`, and `pg` (what a generated schema names). [Postgres’s differences](https://d1-record.forestfuture.dev/postgres) lists what works differently from D1.

The guide is at [d1-record.forestfuture.dev](https://d1-record.forestfuture.dev), and the source is on [GitHub](https://github.com/forestfuture/active-record).
