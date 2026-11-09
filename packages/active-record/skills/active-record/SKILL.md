---
name: active-record
description: Active Record (`@forestfuture/active-record`, with its D1 and PostgreSQL adapters as its `/d1` and `/postgresql` entries), a Rails-style Active Record for Cloudflare Workers. Use when writing code with the package, or deciding how to model D1 or Postgres data in a Worker.
---

# Active Record

## Rules

<!-- #region rules -->

Active Record (`@forestfuture/active-record`) is a Rails-style Active Record for Cloudflare Workers, with an adapter per database inside it: `@forestfuture/active-record/d1` for D1, and `@forestfuture/active-record/postgresql` for Postgres, which needs the app's own `pg`. Import Models, Relations, and errors from the core, and what opens a database from its adapter's entry: `connect`, `withSession`, `NoSession`, and `d1` from `/d1`; `connect` and `postgresql` from `/postgresql`. Every `active-record` command reads `active-record.jsonc`, which names each database's adapter: run `npx active-record init` to write it, never `--adapter`. Its guide for the installed version is `node_modules/@forestfuture/active-record/llms-full.txt`, one Markdown file with a `#` heading per page: read the part for the task before writing code with it.

- Create tables with the generators, never by hand-declaring attributes: `npx active-record g model Post user:references 'title:string!'` writes the migration and the Model; `npx active-record g migration AddSlugToPosts slug:string:unique` writes a change. Apply them with `npx active-record migrate`. After a hand-written migration, run `npx active-record schema`. Never edit the generated `src/db/schema.ts`.
- A Model extends the app's base class: `class Post extends ApplicationRecord {}`. Its table comes from its class name (`Post` → `posts`), or `static override table = "…"`, and its attributes from the schema, so it declares only behavior. Run `npx active-record schema` after adding or renaming a Model, as after a migration: a Model it hasn't seen throws `InvalidModel`. Change how a column is read with an override in the class, `static override attributes = { metadata: "json" } as const`, never by editing the schema. An `INTEGER` holding a Unix time (Drizzle's `timestamp` modes) is `{ type: "datetime", storage: "unixSeconds" }` or `"unixMilliseconds"`. A cell that isn't its attribute's type (a number in an ISO `datetime`, text in an `integer`) fails the load with a `TypeError` naming the attribute: correct the override, don't catch it.
- Start queries and new records from the Model, as in Rails: `User.find(id)`, `User.where(…)`, `User.build(…)`. Each Model queries the binding named in the generated schema its base class holds, during a request. For a D1 Session, wrap the handler in `withSession(request, env.DB, fn)`. For per-request `onQuery`, or tests and scripts outside a Worker, wrap the code once in `withDatabase(connect(env.DB, { … }), fn)`. Records keep the database they came from.
- Never pass a request's whole body, form or query string to a Model: name the fields, with destructuring or `User.permit(await request.json(), "email", "name")` (it reads `FormData` and `URLSearchParams` too). Assigned values are checked against the attribute's type, but that doesn't stop a user setting `role` or `isAdmin`. Check a request value's type before querying with it: `findBy({ token: null })` matches rows whose token is NULL.
- Name attributes in camelCase everywhere: `where`, `order`, `pluck`, `foreignKey`. Column names (snake_case) appear only inside `sql` fragments.
- Write custom SQL as an `sql` tagged template, which binds every value: ``where(sql`lower(${column("email")}) = ${email}`)``. Interpolate an attribute's value with `column("publishedAt").value(date)`, not the bare `Date`, when the attribute is stored as a Unix time: a bare `Date` is ISO text, and it throws `TypeError` when it's compared directly with that column.
- For a raw `env.DB.prepare(…).bind(…)` statement, bind `Post.typeForAttribute("publishedAt").serialize(date)`, which writes the value as the attribute stores it, and read a cell with `.deserialize(cell)`. A value the attribute can't hold throws `TypeError`.
- Bulk writes run when called: `await posts.deleteAll()` and `updateAll(…)` resolve to how many rows; `insert(…)`, `insertAll`, `upsert` and `upsertAll` to `{ rowsAffected, rows }`, where `rows` holds each written row's primary key, or the attributes `returning: [...]` names (`returning: false` for none). Make several writes atomic with one `batch([...])` of their `to…` forms (`toInsert`, `toUpdateAll`, `toDeleteAll`, …) and records' `toSave()`/`toDestroy()`. D1 has no interactive transactions, so a read-then-write can't be atomic.
- Keep the generators' `TEXT` keys, generated in code, for records saved together (`--id integer` gives a key D1 generates instead). An owner whose key is known before its INSERT (generated in code, or already saved) is written in one atomic batch with the records built through it. A key D1 generates exists only after its own write, so each level is then written in a separate batch.
- To change how those keys are made (UUIDv7, ULID, a prefix), override `static generateId` once on the app's base class; don't give each Model's key a `default`. `generateId` sees only the attribute's name, so a value made from other attributes (a slug) goes in a callback.
- Declare associations as fields, passing the target class: `posts = hasMany(Post, { dependent: "destroy" })`, `author = belongsTo(User)`. The field's name is the association's name.
- Change the copy of validation messages with `this.errorMessages({...})` in the `static {}` block of the app's base class (every Model) or a Model (`attributes: { email: { taken: "…" } }` for one attribute), and attribute names with `this.humanAttributeNames({...})`, rather than a `message` on every `validates`. For a custom error, `errors.add("endsAt", { type: "afterStart" })` and give `afterStart` a message there.
- Check what writes return. `save()` and `update()` resolve to `false` when validation fails (reasons in `record.errors`) or a callback aborts (`record.abortReason`). `destroy()` resolves to `false` when a callback aborts, or a `restrictWithError` association refuses (reason in `record.errors`). The `…OrThrow` methods throw instead. Constraint errors, such as `RecordNotUnique`, always throw.

<!-- #endregion rules -->

## Shapes to follow

Generated Models extend `ApplicationRecord`, with their attributes from the schema. Associations are fields, scopes are statics, and validations and callbacks go in the `static {}` block:

```ts
import { belongsTo, hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";

export class User extends ApplicationRecord {
  posts = hasMany(Post, { dependent: "destroy" }); // foreign key inferred: Post's userId

  static active = this.scope((q) => q.where({ isActive: true }));

  static {
    this.validates("email", { presence: true, uniqueness: true });
  }
}

export class Post extends ApplicationRecord {
  user = belongsTo(User); // foreign key inferred: userId
}
```

A Worker queries from its Models, preloads associations with `includes`, and saves a new graph in one call:

```ts
import { User } from "./models";

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      // One query for the users, and one for all their posts.
      const users = await User.includes("posts").order({ createdAt: "desc" }).toArray();
      return Response.json(users);
    }

    const { email } = await request.json<{ email: string }>();
    const user = User.build({ email });
    user.posts().build({ title: "Hello" }); // saved with the user, in one atomic batch
    if (!(await user.save())) {
      return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
    }
    return Response.json(user, { status: 201 });
  },
} satisfies ExportedHandler<Env>;
```

## Where code goes wrong

- **`onQuery` listeners see filtered attributes' values as `"[FILTERED]"`**: passwords, tokens, keys and emails, by Rails' default list. Add names to `static filterAttributes` on the app's base class for other secrets. Values inside `sql` fragments aren't filtered.
- **`relation.toSql()` and `statement.toSql()` show a query's `{ sql, params }` without sending it**, to inspect it while debugging. The params are real values, filtered attributes included, so don't log them where `onQuery` wouldn't. A record's `toSave()`/`toDestroy()` have no `toSql()`.
- **`toJSON()` sends every loaded attribute**, so `Response.json(user)` includes `passwordDigest`. List the names to leave out in `static hiddenAttributes` on the app's base class (exact names; a Model's own list replaces it). `attributes()` still has them.
- **Uniqueness validation is a friendly check, not a guarantee.** Two requests can pass it at once; the table's UNIQUE index decides, and the save then throws `RecordNotUnique`. Declare both.
- **`record.loaded("posts")` reads what was preloaded or already read**, synchronously, and throws `AssociationNotLoaded` otherwise. `await user.posts().toArray()` loads when needed.
- **Page a list with `paginate()`, not a hand-built `limit` and `offset`**: `Post.published().paginate({ page: url.searchParams.get("page") })` casts the untrusted page, caps its size at `static maxPerPage`, and on D1 sends the count with the page in one round trip. `{ count: false }` skips the `COUNT`, which reads (and bills) every matching row.
- **`find(id)` throws `RecordNotFound`**; `findBy(conditions)` resolves to `null`.
- **After-callbacks run once D1 has committed the write.** An error there reaches the caller with the record already saved: nothing rolls back.
- **Read replicas:** wrap the handler in `withSession(request, env.DB, fn)`. Every query in `fn` goes through one D1 Session, and its bookmark is set on `fn`'s Response as a `d1-bookmark` cookie, so the user's next request reads at least as new as their last write. For APIs, pass `{ header: "x-d1-bookmark" }` before `fn`; `start: "first-primary"` starts a request with no bookmark on the primary. Don't read or set the bookmark by hand.
- **Outside a Worker** (tests, scripts) there's no binding to find: run the code in `withDatabase(connect(binding), fn)`, or a query throws `NoDatabase` saying so. With several databases, `withDatabase` can't tell them apart outside a Worker: mock `cloudflare:workers` with the bindings instead (Vitest needs `test.server.deps.inline: ["@forestfuture/active-record"]`), assigning them onto the mocked `env` object. A query at a module's top level fails too: Workers only allow D1 calls during a request.
