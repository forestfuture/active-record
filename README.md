# active-record

[![CI](https://github.com/forestfuture/active-record/actions/workflows/ci.yml/badge.svg)](https://github.com/forestfuture/active-record/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/forestfuture/active-record/badge)](https://scorecard.dev/viewer/?uri=github.com/forestfuture/active-record)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/15356/badge)](https://www.bestpractices.dev/projects/15356)
[![OpenSSF Baseline](https://www.bestpractices.dev/projects/15356/baseline)](https://www.bestpractices.dev/projects/15356)

A Rails-inspired Active Record for [Cloudflare Workers](https://developers.cloudflare.com/workers/), with an adapter for each database: [D1](https://developers.cloudflare.com/d1/) and Postgres.

Models with validations, callbacks, associations, and change tracking; lazy, composable queries; and a predictable save lifecycle, built for the Worker runtime and honest about what each database can and can’t do.

> **Status: pre-release (0.x).** The API is tested against real D1 and Postgres, but it may still change before 1.0.

```sh
npm install @forestfuture/active-record
```

[`@forestfuture/active-record`](packages/active-record/) holds the core (Models, Relations, validations, callbacks, and associations), the `active-record` command, and an adapter for each database:

| Entry                                    |                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `@forestfuture/active-record/d1`         | The D1 adapter: `connect` and `withSession`                               |
| `@forestfuture/active-record/postgresql` | The PostgreSQL adapter, through Hyperdrive or on Node, with your own `pg` |

An app moves from D1 to Postgres with its Models and code unchanged. See [Moving to Postgres](https://active-record.forestfuture.dev/move-to-postgres).

Coming from an earlier release? See [Upgrading](https://active-record.forestfuture.dev/upgrading).

## A quick look

A [Worker](https://developers.cloudflare.com/workers/) is a function that runs at Cloudflare’s edge, and [D1](https://developers.cloudflare.com/d1/) is its SQLite database. Active Record sits between the two: you describe each table once as a **Model**, and your Worker reads and writes **records** instead of rows.

### 1. Bind a D1 database

Create a database with [Wrangler](https://developers.cloudflare.com/workers/wrangler/), Cloudflare’s command-line tool, and add the snippet it prints to your Wrangler config. It gives your Worker a **binding** called `DB`:

```sh
npx wrangler d1 create my-app-db
```

```jsonc
// wrangler.jsonc
{
  "d1_databases": [
    { "binding": "DB", "database_name": "my-app-db", "database_id": "<the id it printed>" },
  ],
}
```

### 2. Generate your models

Name your database in `active-record.jsonc`, which every `active-record` command reads:

```sh
npx active-record init
```

The generator writes each table’s migration and its Model, as `rails generate model` does (it needs Node.js 22.13 or later):

```sh
npx active-record g model User 'email:string!:unique' 'isActive:boolean!=true'
npx active-record g model Post user:references 'title:string!' publishedAt:datetime
npx active-record migrate
npx active-record console # try your Models against the local database
```

Along with the migrations, it writes `src/db/schema.ts` (every table’s columns, generated from the migrations, like Rails’ `schema.rb`) and your app’s `ApplicationRecord`.

### 3. Add behavior

A Model’s table comes from its class name, and its attributes from the schema, so it declares only behavior: associations, scopes, validations, and callbacks.

```ts
// src/models/user.ts
import { hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Post } from "./post";

export class User extends ApplicationRecord {
  posts = hasMany(Post, { dependent: "destroy" }); // posts.user_id points here

  static active = this.scope((q) => q.where({ isActive: true }));

  static {
    this.validates("email", { presence: true, uniqueness: true });
    this.beforeSave((user) => {
      user.email = user.email.toLowerCase();
    });
  }
}
```

```ts
// src/models/post.ts
import { belongsTo } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { User } from "./user";

export class Post extends ApplicationRecord {
  user = belongsTo(User);
}
```

### 4. Use them in your Worker

Queries start from the Model, and use its binding during the request: there’s nothing to connect. (For a D1 Session or per-request logging, see [Connections](https://active-record.forestfuture.dev/connecting).)

```ts
// src/index.ts
import { User } from "./models/user";

export default {
  async fetch(request: Request): Promise<Response> {
    // GET: the 20 newest active users, each with their posts.
    if (request.method === "GET") {
      const users = await User.active()
        .includes("posts") // loaded in one extra query, not one per user
        .order({ createdAt: "desc" })
        .limit(20)
        .toArray();
      return Response.json(users);
    }

    // POST: sign up a user with a first post, saved together.
    const { email } = await request.json<{ email: string }>();
    const user = User.build({ email });
    user.posts().build({ title: "Hello, world" });

    // save() validates and runs callbacks; false means it wasn't saved, and why is in errors.
    if (!(await user.save())) {
      return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
    }
    return Response.json(user, { status: 201 });
  },
} satisfies ExportedHandler<Env>;
```

### 5. Write several things at once, or not at all

D1 can’t keep a transaction open while your code awaits, so there’s no `transaction()` block. Instead, prepare the writes in `batch`’s callback, and they’re sent together, all succeeding or all failing:

```ts
await batch((b) => [
  b.updateAll(Post.where({ publishedAt: null }), { publishedAt: new Date() }),
  b.destroy(user), // and its posts, since posts are dependent: "destroy"
]);
```

## What’s in it

- **Models** whose attributes come from your migrations (`class Post extends ApplicationRecord {}`), typed, with Rails-style generators; or declared with `Model.define({...})`: camelCase attributes over snake_case columns, defaults (including app-generated keys), timestamps, JSON, and dates converted both ways.
- **Queries**: `where`/`whereNot`/`or`/`merge`, comparisons (`gte`, `between`, …), ordering (`nulls: "last"`, `reorder`), pagination (`paginate()`: a page and its total, in one round trip on D1), `select`, `distinct`, `pluck`, `count`, `size`, `exists`, named and default scopes, and hand-written conditions only through the `sql` tagged template, so values are always bound.
- **Persistence**: `save`/`create`/`update`/`destroy` with `…OrThrow` variants, validations (`presence`, `length`, `format`, `inclusion`, `numericality`, `uniqueness`) with error messages you can change, the full Rails callback lifecycle with `abort()`, dirty tracking (`changes`, `attributeWas`, `savedChangeTo`, …).
- **Associations**: `belongsTo` (its record required unless `optional`), `hasMany`, `hasOne` with scopes, `dependent:` strategies, preloading with `includes` (one query per association, never N+1, and on D1 the whole tree on one database in one round trip), caching until reload, autosave (with `autosave: true`, of changed records too, and `markForDestruction()`), `build`/`create`/`set` through the association, and a `hasMany`’s `push`, `delete`, `destroy`, and `clear`, between Models on one database or on two.
- **Queries from the Model**, as in Rails: `User.find(id)`, `User.where(…)`, `User.active()`, on the Model’s binding with no setup.
- **Bulk writes**: `insert`, `insertAll`, `upsert`, `updateAll`, `deleteAll`, and `batch((b) => [...])` mixing those with records’ saves and destroys.
- **Read replicas**: a request run in `withSession(request, env.DB, fn)` sends every query through one D1 Session, so it reads its own writes, and the Session’s bookmark goes to the user’s next request in a cookie or a header.
- **Observability**: `connect(env.DB, { onQuery })` sees every statement with its SQL, bound values, timing, and D1’s `meta`. `toSql()` shows a query’s SQL and values without sending it.

## Honest about D1

The D1 adapter follows Rails wherever D1 allows, and says so where it can’t:

- **No interactive transactions.** D1 can’t hold a transaction open across `await`s, so there’s no `transaction(async tx => …)`. Instead, `batch((b) => [...])` writes a prepared set of bulk writes and records atomically, and a record with `dependent: "destroy"` or new associated records is written in one batch when its keys are known in advance and they’re on one database.
- **Keys generated in code are first-class.** A generated `TEXT` key is a UUID made at `build()` (or whatever your `generateId` makes), so records can be linked and saved together atomically before D1 has seen them.
- **D1’s limits are handled for you.** Lists of any length bind as one value (`json_each`), so a list never runs into the 100-bound-parameter limit. Preloads take one query per association, and the whole tree on one database goes together in one round trip. A nested query that would bind more than 100 values takes one more, and so does a level on another database.
- **Constraint errors become typed errors** (`RecordNotUnique`, `InvalidForeignKey`, `NotNullViolation`, `CheckViolation`) naming the table, columns, and attributes.
- **No request state on Model classes.** A query uses the Model’s binding, the same object for every request, or a database opened for its request with `withDatabase`, so concurrent requests on one isolate never share a Session or listener.

## Coming from Rails

Most of it will feel familiar. The main difference is naming: attributes are camelCase and map to snake_case columns (`createdAt` ↔ `created_at`), and everything names **attributes**, association keys included. Foreign keys are inferred as in Rails (`has_many :posts` on `User` uses `userId`); when you do give one, it’s `foreignKey: "userId"` where Rails writes `foreign_key: :user_id`. Column names only appear in `sql` fragments. Methods that raise end in `OrThrow` instead of `!` (`saveOrThrow` for `save!`), and predicates start with `is`/`has` instead of ending in `?` (`isNewRecord()` for `new_record?`).

## How it compares

Query builders such as [Drizzle](https://orm.drizzle.team) and [Kysely](https://kysely.dev) are SQL-first: you write queries against a typed schema, and rows come back as plain objects. This library is an Active Record: rows come back as records that know how to validate, save, destroy, and load their associations, with the conventions of Ruby on Rails. Its value is a coherent, rigorously tested lifecycle rather than advanced type inference. If you know Rails, you already know most of it.

## Versioning

The packages follow [semantic versioning](https://semver.org), and always share a version, so install the same one of each. While they’re on 0.x, a breaking change bumps the minor version (0.5 → 0.6), and features and fixes bump the patch, so a `^0.6.0` range never brings in a breaking change. Every release is listed on the [releases page](https://github.com/forestfuture/active-record/releases), and in each package’s `CHANGELOG.md`.

## For AI agents

The guide is also published for coding agents: [`llms.txt`](https://active-record.forestfuture.dev/llms.txt), [`llms-full.txt`](https://active-record.forestfuture.dev/llms-full.txt), and every page as Markdown. The package ships the guide for its own version (`node_modules/@forestfuture/active-record/llms-full.txt`) and an [agent skill](packages/active-record/skills/active-record/SKILL.md) (`npx skills add forestfuture/active-record`). See [AI agents](https://active-record.forestfuture.dev/ai-agents).

## Documentation

The guide is at [active-record.forestfuture.dev](https://active-record.forestfuture.dev), built from [`site/`](site/). In the repository:

- [`site/docs/`](site/docs/): the guide pages, from getting started to each adapter’s differences.
- [`docs/contract.md`](docs/contract.md): the full public behavior, which the tests prove.
- [`GLOSSARY.md`](GLOSSARY.md): the domain glossary (Model, Record, Relation, Association, Batch, …).
- [`docs/adr/`](docs/adr/): the architecture decisions and why they were made.

## Development

This project uses [Vite+](https://viteplus.dev) (`vp`) and pnpm. Library code runs on Workers; the tests run a real D1 through Miniflare in Node.

```sh
vp install                # install dependencies (sets up git hooks)
vp check                  # format, lint and type-check
vp test                   # unit and integration tests against a real local D1
vp pack                   # build the library into dist/
vp run check:public-types # after vp pack: the published types expose no internals
vp run test:remote        # the smoke suite against a real remote D1 (see docs/agents/remote-smoke.md)
vp run docs:dev           # the documentation site, at localhost:4321
```

How issues are worked, from agreeing the design to review, is in [`docs/agents/workflow.md`](docs/agents/workflow.md).

## Contributing and security

Ideas and questions are welcome in the [ForestFuture discussions](https://github.com/orgs/forestfuture/discussions). See the [contributing guide](CONTRIBUTING.md) and the [code of conduct](https://github.com/forestfuture/.github/blob/main/CODE_OF_CONDUCT.md). Please report security problems privately, as described in the [security policy](https://github.com/forestfuture/.github/blob/main/SECURITY.md).

## License

[MIT](LICENSE)
