# active-record

A Rails-inspired Active Record library for Cloudflare Workers: a core (`@forestfuture/active-record`) and an **Adapter** for each database, D1's first (`@forestfuture/d1-record`). It maps a database's rows to domain objects with a lazy, composable query vocabulary and a predictable persistence lifecycle.

## Language

**Model**:
A class extending the app's **Base class** that describes one table: its attributes, validations, callbacks, associations and scopes. Its table is named after its class (`Post` → `posts`), or by `static table`; a subclass of a Model shares its table.
_Avoid_: Record (as the base class; `ApplicationRecord` is the one exception, named as Rails names it), entity, schema

**Generated Model**:
A **Model** whose attributes are its table's in the **Generated schema**, after its **Override**s. `active-record schema` must have seen its class: one it hasn't is an `InvalidModel` when used.
_Avoid_: Plain model, schema model

**Hand-declared Model**:
A **Model** whose attributes are declared in its class, with `Model.define({...})` or `ApplicationRecord.define({...})`, for a table no migration makes.
_Avoid_: Manual model, defined model

**Generated schema**:
The file `active-record schema` writes from a project's migrations and Model files, with its **Adapter** reading the migrations: each table's attributes, its **Adapter** and **Binding** (`adapter: d1({ binding: "DB" })`), the **Generated Model**s, and type declarations adding each one's attributes to its class. It's a document like Rails' `schema.rb`, committed and never edited by hand; the app's **Base class** holds it.
_Avoid_: Schema dump, types file

**Base class**:
The app's abstract class extending `Model`, `ApplicationRecord` (in `application-record.ts`), that holds the **Generated schema** and that every Model is built on, so the methods, callbacks and scopes written on it are shared. It has no table. Neither does a class between it and some Models marked `static abstract = true`.
_Avoid_: Mixin, concern, parent model

**Migration**:
A SQL file in a database's migrations folder, applied once, in file-name order. Its version is the number its name starts with: a UTC timestamp as the **Generator**s write it (`20261108090503_create_products.sql`), or any leading number (`0001_…`). Wrangler records D1's applied migrations; on Postgres, `active-record migrate` records each one's version in `schema_migrations`.
_Avoid_: Schema change, patch, revision

**Project config**:
The project's `active-record.jsonc`, beside its `package.json`: settings the `active-record` command reads, through the **Adapter**'s plugin. On Postgres it declares the databases (`databases.HYPERDRIVE.url`); D1's stay in the Wrangler config.
_Avoid_: Database config, settings file, active-record.json

**Generator**:
The `active-record g model` and `g migration` commands: they write a migration (and a Model) from a name and columns, checked against the existing migrations first.
_Avoid_: Scaffold, codegen

**Console**:
The interactive session `active-record console` opens: a REPL on the project's local database, with its Models and `db` in scope and each line run against that database. Local unless `--remote`, which opens the real database after its name is typed. With `-e` it isn't a session: it runs one piece of code, prints its result alone, and exits. A **Generator** writes files; the console works with data.
_Avoid_: Shell, REPL (in the guide), playground

**Override**:
A change a **Generated Model** makes to an attribute of its table, in `static attributes` (its type, nullability, default, **Generated id**, or **Epoch storage**), or `false` to ignore the column.
_Avoid_: Patch, customization

**Epoch storage**:
How a `datetime` **Attribute** is held when its column is an `INTEGER` of Unix time, not ISO text: `storage: "unixSeconds"` or `"unixMilliseconds"`, as Drizzle's `timestamp` and `timestamp_ms` modes write it. The attribute is still a `Date`.
_Avoid_: Numeric datetime, timestamp mode

**Record**:
One instance of a **Model**, representing a single row that is either persisted or not yet saved.
_Avoid_: Row (outside the hydration boundary), object, instance

**New record** / **Persisted record** / **Destroyed record**:
The three lifecycle states of a **Record**: not yet written, backed by a row, or backed by a row that this instance deleted. A destroyed record is a read-only snapshot of the deleted row.
_Avoid_: Saved, deleted, frozen

**Cast**:
Reading a value given to an attribute as the attribute's type, by how it reaches the attribute (its use), accepting only what's unambiguous: `"false"` is `false` for a boolean, `"42"` is 42 for an integer. **Assigned** values (set, built, given to a bulk write or `permit`) are strict. **Condition** values also read a number as its digits for a string attribute. **Key** values (copied from another record through an association, or inherited from a Relation's conditions) are cast as condition values are. A value that can't be cast is **uncastable**: an assigned or key value is an error, and a condition with one matches nothing.
_Avoid_: Coerce, convert (D1's storage form is conversion), parse

**Stored cell**:
A value D1 returned for one column of a row: a number, text, or NULL. It's read as its **Attribute**'s type or refused with a `TypeError` naming the Model and attribute, and never coerced, as a **Cast** value may be. A record load, `pluck`, and `deserialize` read it the same way.
_Avoid_: Raw value, database value, value from D1

**Filtered attribute**:
An attribute whose values listeners, errors, and a printed record show as `"[FILTERED]"` (passwords, tokens, keys, emails), named by the Model's `filterAttributes`. D1 still gets the real values.
_Avoid_: Redacted, masked, sensitive field; and "filter" alone, which means a **Scope**'s conditions

**Hidden attribute**:
An attribute `toJSON()` leaves out, named by the Model's `hiddenAttributes`, by exact name. `attributes()` still has it. Independent of a **Filtered attribute**, which is about logs and errors.
_Avoid_: Private, protected, excluded

**Error message**:
The text of a validation error, looked up from its type (`blank`, `tooShort`, or one of the app's own) each time it's read: the Model's `errorMessages` (for the attribute first), then those of each class it extends, then the built-in English. A message can have **forms**: `{ one, other }`, chosen by the error's `count`, or `restrictDependentDestroy`'s `{ hasOne, hasMany }`, chosen by the kind of association. Text given to `validates` or `errors.add` is used as it is.
_Avoid_: Translation, locale string, i18n key (no locales yet)

**Human attribute name**:
An attribute's name as error messages show it: from `humanAttributeNames`, or the attribute in words (`createdAt` → "Created at").
_Avoid_: Label, display name, title

**Snapshot**:
A Record's attribute values as last loaded from or saved to D1. Changes are measured against it, and `reload()` replaces it.
_Avoid_: Original, previous values, dirty state

**Partial record**:
A **Record** loaded through a Relation with `select(...)`. Only the selected attributes and the primary key are loaded. Reading any other attribute is an error, not `null`.
_Avoid_: Projection, sparse record

**SQL fragment**:
A piece of SQL built with the `sql` tagged template, in which every interpolated value is a bound parameter. It's the only form in which hand-written SQL reaches a Relation.
_Avoid_: Raw SQL, string condition

**Typed value**:
A value in an **SQL fragment** written as `column(attribute).value(v)`: cast as an assigned value of that **Attribute**, and written as the attribute stores it (an integer for **Epoch storage**), still a bound parameter. A bare interpolated value has no attribute, so it's written by its JavaScript type.
_Avoid_: Bound attribute, cast value

**Attribute conversions**:
The `cast`, `serialize` and `deserialize` of one **Attribute**, from `Model.typeForAttribute(name)`: the same steps a record uses, for SQL the library doesn't write. `serialize` is what a **Typed value** binds.
_Avoid_: Attribute type (that is the declared type, `"datetime"`), codec, serializer

**Abort**:
A deliberate refusal raised by a pre-write callback with `abort(reason)`. It cancels the write without being a validation failure.
_Avoid_: Halt, cancel, returning false

**Database**:
A wrapper around a `D1Database` binding, made with `connect(env.DB, { session, onQuery })`, that queries go through. It's the **Current database** for a request run in `withDatabase`, or used explicitly with `db.model(User)`; a Model's **Binding** gets one with no per-request options. An error names a database by where it came from: `connect()`, the request, or a binding.
_Avoid_: Connection, client, context (on its own)

**Attribute**:
A value declared on a **Model**, with a camelCase name, the snake_case column it maps to, and a type that says how its value moves between JavaScript and SQLite. Only declared attributes can appear in object-style queries or be written.
_Avoid_: Field, property

**Generated id**:
A string **Attribute** declared with `generateId: true`, whose value, when not given, comes from its **Model**'s `generateId` where a default would: a key made in code, before the row is written. A string primary key without a literal default in the **Generated schema** is one: `TEXT` on D1, `UUID` (or `TEXT`) on Postgres.
_Avoid_: Generated attribute, auto id

**Column**:
The D1 table column behind an **Attribute**. The word only applies on the SQL side: raw SQL fragments name columns, and everything else names attributes.
_Avoid_: Attribute (when talking about SQL)

**Relation**:
A lazy, immutable description of a query against one **Model**. Each modifier returns a new Relation, and only a terminal operation (`toArray`, `first`, `count`, …) runs a query.
_Avoid_: Query, query builder, scope (for a Relation)

**Page**:
One page of a **Relation**'s records, from `paginate()`, with its position (`page`, `perPage`, `hasNext`, `hasPrevious`) and, when counted, the `total` it's a page of. A plain object, ready for `Response.json()`.
_Avoid_: Paginator, cursor (that's keyset pagination), batch (that's D1's)

**Scope**:
A named, reusable change to a Relation, declared on a **Model**, that may take arguments. Calling a scope never runs a query. Not a **Database scope**.
_Avoid_: Filter, named query

**Association**:
A named link from one **Model** to another through a foreign-key **Attribute**: `belongsTo`, `hasMany` or `hasOne`.
_Avoid_: Relationship, relation (a Relation is a query)

**Preload**:
Loading an **Association** for many **Records** at once, in a small, bounded number of queries (one per association, the whole tree sent with the records' query in one round trip), so each becomes a **Loaded association**. You ask for it with `includes`.
_Avoid_: Eager load, join

**Loaded association**:
An **Association** a **Record** already holds, preloaded or read once, so reading it again needs no query. It stays loaded while the key it was loaded for is unchanged, until the record is reloaded.
_Avoid_: Cached association (outside the implementation), memoized

**Association scope**:
A change to an **Association**'s **Relation** declared with the association (its order or conditions), applied whenever the association is read, preloaded or written through. Unlike a **Scope**, it has no name of its own.
_Avoid_: Scope (on its own), default scope

**Dependent strategy**:
What destroying a **Record** does to an **Association**'s records: destroy them, delete them, nullify their foreign key, or refuse while they exist (a restriction, which isn't an **Abort**).
_Avoid_: Cascade (that's the database's), dependent destroy (for all of them)

**Query listener**:
A function called once per statement sent to D1 (`onQuery`): a database's, for one request's queries, or a Model class's (`static onQuery`, usually on the **Base class**), for every query of its Models. It only observes: it never changes a query's outcome.
_Avoid_: Logger, hook, middleware

**Current database**:
The database a query started from a Model (`User.find(id)`) uses: the request's, set with `withDatabase`, or else the Model's **Binding**'s. Never stored on a class.
_Avoid_: Default connection, global database

**Database scope**:
One `withDatabase` call's time with a **Database**, during which its **Adapter** may hold a connection for it (pg-record does, from a connection string). Each call has its own, even with a Database other requests share; a call nested in a running one shares it. In the `/adapter` interface, a driver's `openScope` and `closeScope` begin and end it.
_Avoid_: Scope (on its own: that's a Model's), request scope, transaction

**Adapter**:
The package for one database, under the Active Record core (#260, ADR-0016): its driver, SQL dialect, type mapping, constraint errors and schema reader. `d1-record` becomes one, and `pg-record` is the second. The **Generated schema** names it.
_Avoid_: Dialect (one part of an adapter), driver, connector

**Allowed difference**:
A contract behavior an **Adapter** keeps its database's own semantics for, such as how NULLs sort (ADR-0017). The conformance suite lists each, with the reason and the tests it skips on that adapter, and the adapter's own tests and docs show what it does instead. D1 sets the baseline, so it has none.
_Avoid_: Quirk, known difference, incompatibility, bug

**Binding**:
The name the app's config gives the database a Model queries, in the **Generated schema** its **Base class** holds (`d1({ binding: "DB" })`). On D1, it's a binding from the Wrangler config, `env.DB`. On Postgres, it's a Hyperdrive binding (`env.HYPERDRIVE`) or a variable holding a connection string (`env.DATABASE_URL`), and the **Project config** declares it, with its local and remote connection strings for the command.
_Avoid_: Connection name, database name

**Session**:
A D1 session that one **Database** can be opened with. Every query in that request goes through it, so the request reads its own writes even when reads are served by replicas.
_Avoid_: Transaction, connection

**Bookmark**:
Where a **Session** has got to, from `db.bookmark()`. The next request's Session starts from it, so that request reads at least as new as this one wrote. `withSession` carries it between requests in a cookie or a header.
_Avoid_: Token, cursor, version

**Statement**:
A bulk write prepared for a **Batch** rather than run (`toInsert`, `toUpdateAll`, `toDeleteAll`, …), skipping validations and callbacks. It runs only with its **Batch**, and is never run by being awaited. Its SQL can be read with `toSql()`, unsent.
_Avoid_: Query, command

**Write result**:
What a bulk write resolves to, alone or in a **Batch**: `{ rowsAffected, rows }`, the number of rows it wrote and, for an insert or upsert, the `returning` attributes of each row (its primary key by default). The same on every database.
_Avoid_: Meta, last insert ID

**Batch**:
An atomic group of **Statements** and **Record statements** run together with D1's `batch()`: all are written, or none.
_Avoid_: Transaction

**Autosave**:
Saving a **Record** also saves the new records of its **Associations**, validated with it: those built through a has-many or has-one, after it and with its key (and theirs, at every level), and a new record it points at through a belongs-to, before it, so it can take that record's key.
_Avoid_: Nested save, cascade save

**Record statement**:
A **Record**'s save or destroy as part of a **Batch** (`user.toSave()`). Unlike a **Statement**, it isn't compiled in advance: the record's validations and callbacks run when the batch runs. It's never run by being awaited.
_Avoid_: Pending save, deferred write
