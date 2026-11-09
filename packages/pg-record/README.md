# @forestfuture/pg-record

The Postgres adapter for [`@forestfuture/active-record`](https://www.npmjs.com/package/@forestfuture/active-record), on Cloudflare Workers through [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) and on Node.

```sh
npm install @forestfuture/active-record @forestfuture/pg-record pg
```

Open a database from a Hyperdrive binding, a connection string, or your own `pg` Pool:

```ts
import { withDatabase } from "@forestfuture/active-record";
import { connect } from "@forestfuture/pg-record";

const db = connect(env.HYPERDRIVE);
await withDatabase(db, () => app.fetch(request, env));
```

It provides `connect`, `Database`, and `pg` (what a generated schema names), and a plugin for the `active-record` command: declare your databases in `active-record.jsonc`, and `npx active-record schema`, `g model`, `migrate`, and `console` work on Postgres. The guide’s [Postgres](https://active-record.forestfuture.dev/postgres) page lists what works differently from D1.

The guide is at [active-record.forestfuture.dev](https://active-record.forestfuture.dev), and the source is on [GitHub](https://github.com/forestfuture/active-record).
