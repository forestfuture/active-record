// Relation: the chainable query (`where`, `order`, …), its finders, terminals, and bulk writes.
import { jointly } from "./executor.ts";
import { compileExists, querySql, type QuerySql } from "./compiler.ts";
import { RecordNotFound, RecordNotUnique } from "./errors.ts";
import { includeTree } from "./preload.ts";
import { mergedQuery, withJoins } from "./joins.ts";
import { inspectCustom, type Inspect, type InspectOptions } from "./inspect-support.ts";
import { inspectRelation } from "./relation-inspect.ts";
import { runnerFor, selectForToSql, type QueryRunner } from "./load.ts";
import { eachOnce, findById, findOne, findSome, keysToFind } from "./find.ts";
import { allOf, either, LinkedTo, mergeTrees, Negated, type QueryDescription } from "./query.ts";
import type { Executor } from "./executor.ts";
import { attributeOf } from "./metadata.ts";
import {
  type AttributesOf,
  type IncludeSpec,
  type JoinSpec,
  type Model,
  type ModelClass,
} from "./model.ts";
import { SafeSql } from "./sql.ts";
import {
  checkChanges,
  checkConditions,
  checkQuery,
  requireSameModel,
  scopeResultError,
  isEmptyConditions,
  orderTerms,
  type Conditions,
  type InsertOptions,
  type OrderSpec,
  writableQuery,
  type Returning,
  type UpsertOptions,
} from "./relation-checks.ts";
import { alsoClearing, unowned, type OwnedCollection } from "./owned-collection.ts";
import { atMostOne, finderOrder, oneInOrder, reversed, thenPrimaryKey } from "./finder-order.ts";
import { runAlone, type Statement } from "./statement.ts";
import type { ReturnedRow, WriteResult } from "./statement.ts";
import {
  clearCollectionUntilWritten,
  preparedWrites,
  preparedWritesOf,
  type PreparedWrites,
} from "./prepared-writes.ts";
import { buildThrough, createThrough, type Init, type RelationState } from "./record-creation.ts";
import { destroyTogether } from "./records-together.ts";
import { grouped, type GroupedRelation, type GroupTerms } from "./grouping.ts";
import { paginate, type CountlessPage, type Page, type PageOptions } from "./pagination.ts";
import {
  count,
  runCalculation,
  pluck,
  type CalculatedValue,
  type ValueSource,
  type NumberAttribute,
  type Operation,
  type OrderedAttribute,
  requireOperation,
} from "./calculations.ts";

declare const scopeTypes: unique symbol;

/** @internal The library's key for the query a Relation describes. */
export const queryOf = Symbol("queryOf");

/** @internal The library's key for narrowing a Relation to the records linked to another's (#59). */
export const linkedToRecordsOf = Symbol("linkedToRecordsOf");

/** @internal The library's key for making a hasMany Relation of an owner. */
export const ofOwner = Symbol("ofOwner");

/** @internal The library's key for running a scope on a Relation. */
export const applyScope = Symbol("applyScope");

/** A scope: receives the current Relation and its arguments, and returns a changed Relation. */
// oxlint-disable-next-line typescript/no-explicit-any -- scope arguments are the scope's own business
export type Scope<M extends Model> = (relation: Relation<M>, ...args: any[]) => Relation<M>;

/** The scope methods a Model's scopes `S` add to its Relations: `active()`, `createdAfter(date)`. */
export type ScopeMethods<M extends Model, S> = {
  [K in keyof S]: S[K] extends (this: never, ...args: infer A) => unknown
    ? (...args: A) => Scoped<M, S>
    : never;
};

/** A Relation of Model records `M` with the Model's scope methods `S`. */
export type Scoped<M extends Model, S = {}> = [keyof S] extends [never]
  ? Relation<M, S>
  : Relation<M, S> & ScopeMethods<M, S>;

/** A lazy, immutable description of a query against one Model. */
export class Relation<M extends Model, S = {}> {
  /** Type-only: the Model's scopes, so chained calls keep their scope methods. */
  declare readonly [scopeTypes]?: S;

  readonly #executor: Executor;
  readonly #model: ModelClass<M>;
  readonly #query: QueryDescription;
  /** How its query runs: on D1, or not at all for `none()`. */
  readonly #runner: QueryRunner<M>;
  /** What a hasMany's owner already knows about it, or `unowned`. Not query data. */
  readonly #collection: OwnedCollection;

  /**
   * Relations come from `db.model(Model)` and from other Relations, never `new Relation()`:
   * what one is made from is the library's own business.
   */
  protected constructor(parts: unknown) {
    const { executor, model, query, collection } = parts as RelationParts<M>;
    this.#executor = executor;
    this.#model = model;
    this.#query = query ?? allOf(model);
    this.#runner = runnerFor(executor, model, this.#query);
    this.#collection = collection ?? unowned;
  }

  where(conditions: Conditions<M> | SafeSql): Scoped<M, S> {
    checkConditions(this.#model, conditions, "where");
    if (isEmptyConditions(conditions)) return this.#scoped(this);
    return this.#with({ conditions: [...this.#query.conditions, conditions] });
  }

  /** Negates the whole condition: `NOT (…)`. Rows where it is NULL are excluded too. */
  whereNot(conditions: Conditions<M> | SafeSql): Scoped<M, S> {
    checkConditions(this.#model, conditions, "whereNot");
    if (isEmptyConditions(conditions)) return this.#scoped(this);
    return this.#with({ conditions: [...this.#query.conditions, new Negated(conditions)] });
  }

  /** A Relation that matches nothing and never queries D1; it stays empty when chained. */
  none(): Scoped<M, S> {
    return this.#with({ none: true });
  }

  /**
   * Rows matching this Relation's conditions or `other`'s. Both must be of the same Model and
   * identical in everything but their conditions (select, order, limit, offset, distinct).
   */
  or(other: Relation<M, S>): Scoped<M, S> {
    requireSameModel(this.#model, other.#model, "or");
    return this.#joining(other, "or()").#describing(either(this.#query, other.#query));
  }

  /**
   * ANDs `other`'s conditions onto this Relation's. For select, order, limit, offset and
   * distinct, a clause `other` sets explicitly replaces this one's; one it doesn't set is kept.
   * Orders are replaced, not concatenated (a deliberate difference from Rails). `other` may be a
   * Relation of a Model this one joins once (#24): its conditions apply to the joined table.
   */
  merge<T extends Model = M, O = S>(other: Relation<T, O>): Scoped<M, S> {
    return this.#joining(other, "merge()").#describing(mergedQuery(this.#query, other.#query));
  }

  /**
   * Sorts by each key in turn (`{ createdAt: "desc" }`, or `{ role: { direction: "asc",
   * nulls: "last" } }`), or by an `sql` fragment expression. Repeated calls append.
   */
  order(spec: OrderSpec<M> | SafeSql): Scoped<M, S> {
    return this.#with({ order: [...this.#query.order, ...orderTerms(this.#model, spec, "order")] });
  }

  /** Replaces the order so far, as in Rails; `reorder()` removes it. */
  reorder(spec?: OrderSpec<M> | SafeSql): Scoped<M, S> {
    const order = spec === undefined ? [] : orderTerms(this.#model, spec, "reorder");
    return this.#with({ order, reordered: true });
  }

  limit(count: number): Scoped<M, S> {
    return this.#with({ limit: count });
  }

  offset(count: number): Scoped<M, S> {
    return this.#with({ offset: count });
  }

  /** Loads only these attributes (a partial record); the primary key is always loaded. */
  select(...attributes: (keyof AttributesOf<M> & string)[]): Scoped<M, S> {
    for (const name of attributes) attributeOf(this.#model, name);
    return this.#with({ select: attributes });
  }

  /** Removes duplicate rows (of the selected attributes). */
  distinct(): Scoped<M, S> {
    return this.#with({ distinct: true });
  }

  /**
   * Preloads associations for every record this Relation loads, so reading them afterwards
   * sends no query: `includes("posts", "profile")`, nested `includes({ posts: "comments" })`.
   */
  includes(...specs: IncludeSpec<M>[]): Scoped<M, S> {
    const added = includeTree(this.#model, specs);
    return this.#with({ includes: mergeTrees(this.#query.includes ?? {}, added) });
  }

  /**
   * Joins associations (`INNER JOIN`), so only records with a linked record are found:
   * `joins("author")`, nested `joins({ author: "company" })`. Loads only this Model's columns.
   */
  joins(...specs: JoinSpec<M>[]): Scoped<M, S> {
    return this.#describing(withJoins(this.#query, specs, "inner", this.#executor));
  }

  /** Joins associations as `joins()` does, but with `LEFT OUTER JOIN`: unlinked records stay. */
  leftJoins(...specs: JoinSpec<M>[]): Scoped<M, S> {
    return this.#describing(withJoins(this.#query, specs, "left", this.#executor));
  }

  /**
   * Attributes for the records this Relation builds, creates or inserts, but not conditions its
   * finders use: `createWith({ role: "member" }).findOrCreateBy({ email })`. Added to any it has;
   * `null` removes them. They win over its conditions' values; attributes given to `build`,
   * `create` or `insert` win over them.
   */
  createWith(attributes: Partial<AttributesOf<M>> | null): Scoped<M, S> {
    if (attributes === null) return this.#with({ createWith: undefined });
    for (const name of Object.keys(attributes)) attributeOf(this.#model, name);
    return this.#with({ createWith: { ...this.#query.createWith, ...attributes } });
  }

  /**
   * @internal This Relation as a hasMany of an owner: answered from what the owner holds
   * once loaded, or, for an owner without a key, finding nothing stored and refusing `create`.
   */
  [ofOwner](collection: OwnedCollection): Scoped<M, S> {
    const Class = this.constructor as new (...args: RelationArgs<M>) => Scoped<M, S>;
    const query = collection.refusal === undefined ? this.#query : { ...this.#query, none: true };
    return new Class({ executor: this.#executor, model: this.#model, query, collection });
  }

  /** @internal The query this Relation describes. */
  get [queryOf](): QueryDescription {
    return this.#query;
  }

  /**
   * @internal This Relation narrowed to the records whose `attribute` is the `ownerKey` of a
   * record `owners` finds, with a subquery: `attribute IN (SELECT ownerKey …)`.
   */
  [linkedToRecordsOf](attribute: string, owners: QueryDescription, ownerKey: string): Scoped<M, S> {
    if (owners.none) return this.none();
    const linked = new LinkedTo(attribute, owners, ownerKey);
    return this.#with({ conditions: [...this.#query.conditions, linked] });
  }

  /**
   * A new, unsaved record of this Relation's Model, handed to `init` first if it's given. Built
   * through a hasMany, it joins the association, and saving the owner saves it too (autosave).
   */
  build(attributes: Partial<AttributesOf<M>> = {}, init?: (record: M) => void): M {
    return buildThrough(this.#state, attributes, init);
  }

  /**
   * Inserts one row now: `await db.model(Post).insert({ title })`. Resolves to how many rows it
   * wrote and the `returning` attributes of each (the primary key by default; `false` for none).
   * Skips validations and callbacks; declared defaults, generated ids, and timestamps apply, and
   * this Relation's equality conditions are inserted too, as with `build()`. A duplicate throws,
   * unless `onDuplicate: "skip"` (Rails' `insert`). `b.insert` is the same write, for a batch.
   */
  async insert<const R extends Returning<M> | undefined = undefined>(
    attributes: Partial<AttributesOf<M>>,
    options: InsertOptions<M> & { returning?: R } = {},
  ): Promise<WriteResult<ReturnedRow<M, R>>> {
    return runAlone(this[preparedWrites].insert(attributes, options));
  }

  /**
   * Inserts several rows with the same attributes now (Rails' `insert_all!`): in one statement,
   * or several in one atomic batch when they pass the database's cap on one value.
   */
  async insertAll<const R extends Returning<M> | undefined = undefined>(
    rows: readonly Partial<AttributesOf<M>>[],
    options: InsertOptions<M> & { returning?: R } = {},
  ): Promise<WriteResult<ReturnedRow<M, R>>> {
    return runAlone(this[preparedWrites].insertAll(rows, options));
  }

  /**
   * Inserts a row now, or updates it when it clashes with the unique index on `uniqueBy` (the
   * primary key by default): every given attribute but those and `createdAt`, with `updatedAt`
   * set, as Rails' `upsert` does. Resolves as `insert` does, returning inserted and updated rows.
   */
  async upsert<const R extends Returning<M> | undefined = undefined>(
    attributes: Partial<AttributesOf<M>>,
    options: UpsertOptions<M> & { returning?: R } = {},
  ): Promise<WriteResult<ReturnedRow<M, R>>> {
    return runAlone(this[preparedWrites].upsert(attributes, options));
  }

  /** `upsert` for several rows with the same attributes, now (Rails' `upsert_all`). */
  async upsertAll<const R extends Returning<M> | undefined = undefined>(
    rows: readonly Partial<AttributesOf<M>>[],
    options: UpsertOptions<M> & { returning?: R } = {},
  ): Promise<WriteResult<ReturnedRow<M, R>>> {
    return runAlone(this[preparedWrites].upsertAll(rows, options));
  }

  /** @internal Each bulk write as a Statement, unsent: what a Batch's methods prepare. */
  get [preparedWrites](): PreparedWrites<M> {
    return preparedWritesOf(this.#state);
  }

  /**
   * Updates every row this Relation matches, now, setting attribute values or an `sql`
   * fragment: ``updateAll(sql`${column("views")} = ${column("views")} + 1`)``. Resolves to the
   * number of rows updated. Skips validations and callbacks, and leaves `updatedAt` alone, as in
   * Rails. A `none()` Relation sends nothing and resolves to 0.
   */
  async updateAll(changes: Partial<AttributesOf<M>> | SafeSql): Promise<number> {
    checkChanges(this.#model, changes);
    writableQuery(this.#query, "updateAll");
    return this.#countOf(() => this[preparedWrites].updateAll(changes));
  }

  /**
   * Deletes every row this Relation matches, now, resolving to the number of rows. On a hasMany
   * association itself (`user.posts().deleteAll()`), the rows' foreign key is set to NULL
   * instead unless its `dependent:` deletes, as in Rails. A `none()` Relation sends nothing and
   * resolves to 0.
   */
  async deleteAll(): Promise<number> {
    writableQuery(this.#query, "deleteAll");
    return this.#countOf(() => this[preparedWrites].deleteAll());
  }

  /**
   * Loads the records this Relation matches and destroys each, callbacks and `dependent:`
   * strategies included, as one write: if one refuses, it throws `RecordNotDestroyed` and nothing
   * is destroyed. Resolves to the records, each once, though a join repeats it (#24). A `none()`
   * Relation sends nothing and resolves to [].
   * Through a hasMany, what its owner loaded is cleared.
   */
  async destroyAll(): Promise<M[]> {
    const landed = clearCollectionUntilWritten(this.#state);
    const records = eachOnce(await this.toArray());
    await destroyTogether(records, "destroyAll() needs its records");
    landed();
    return records;
  }

  /** Destroys the records matching `conditions`, as `where(conditions).destroyAll()` does. */
  async destroyBy(conditions: Conditions<M> | SafeSql): Promise<M[]> {
    return this.where(conditions).destroyAll();
  }

  /** Deletes the rows matching `conditions`, as `where(conditions).deleteAll()` does. */
  async deleteBy(conditions: Conditions<M> | SafeSql): Promise<number> {
    return this.where(conditions).deleteAll();
  }

  /**
   * Builds and runs a statement from this Relation: the rows it changed, or 0 without a query on
   * `none()`, which never builds it, so it needs no database to compile for.
   */
  async #countOf(build: () => Statement): Promise<number> {
    return this.#runner.changes(() => runAlone(build()));
  }

  /**
   * Builds a record, awaits `init` with it if it's given, and saves it; resolves to it whether or
   * not it was saved (check `isPersisted()`).
   */
  async create(attributes: Partial<AttributesOf<M>> = {}, init?: Init<M>): Promise<M> {
    return createThrough(this.#state, attributes, { init, orThrow: false });
  }

  /** Like `create`, but throws if the record can't be saved. */
  async createOrThrow(attributes: Partial<AttributesOf<M>> = {}, init?: Init<M>): Promise<M> {
    return createThrough(this.#state, attributes, { init, orThrow: true });
  }

  /**
   * The record with this primary key, keeping this Relation's conditions. With several ids,
   * `find(1, 2)` or `find([1, 2])`, the records in the ids' order (or this Relation's order,
   * if it has one), as Rails does; `RecordNotFound` if any is missing.
   */
  async find(id: string | number): Promise<M>;
  async find(ids: readonly (string | number)[]): Promise<M[]>;
  async find(
    first: string | number,
    second: string | number,
    ...rest: (string | number)[]
  ): Promise<M[]>;
  async find(...args: (string | number | readonly (string | number)[])[]): Promise<M | M[]> {
    const [only] = args;
    if (args.length === 1 && (typeof only === "string" || typeof only === "number")) {
      return findById(this.#runner, this.#query, only);
    }
    const ids = keysToFind(this.#model, args.flat());
    return ids.length === 0 ? [] : findSome(this.#runner, this.#query, ids);
  }

  /** The first record matching `conditions` (in no particular order), or null. */
  async findBy(conditions: Conditions<M> | SafeSql): Promise<M | null> {
    const relation = this.where(conditions);
    return findOne(relation.#runner, relation.#query);
  }

  /**
   * The first record with these attributes or, when none has them, one created with them (and
   * handed to `init` before it's saved), as `create` does: check `isPersisted()`. Two requests at
   * once can both create one; `createOrFindBy` is safe from that.
   */
  async findOrCreateBy(attributes: Partial<AttributesOf<M>>, init?: Init<M>): Promise<M> {
    return (await this.findBy(attributes)) ?? this.create(attributes, init);
  }

  /** Like `findOrCreateBy`, but throws if the record it creates can't be saved. */
  async findOrCreateByOrThrow(attributes: Partial<AttributesOf<M>>, init?: Init<M>): Promise<M> {
    return (await this.findBy(attributes)) ?? this.createOrThrow(attributes, init);
  }

  /**
   * The first record with these attributes or, when none has them, a new one built with them and
   * handed to `init`, which is awaited. Saves nothing.
   */
  async findOrInitializeBy(attributes: Partial<AttributesOf<M>>, init?: Init<M>): Promise<M> {
    const found = await this.findBy(attributes);
    if (found !== null) return found;
    const record = this.build(attributes);
    await init?.(record);
    return record;
  }

  /**
   * Creates a record with these attributes (handing it to `init` first), as `create` does, or,
   * when a unique index refuses it (`RecordNotUnique`), finds the record with these attributes:
   * safe where two requests create at once, as `findOrCreateBy` isn't. Throws `RecordNotFound`
   * if the index refused a value the attributes don't name.
   */
  async createOrFindBy(attributes: Partial<AttributesOf<M>>, init?: Init<M>): Promise<M> {
    return this.create(attributes, init).catch((error) => this.#findAfterClash(error, attributes));
  }

  /** Like `createOrFindBy`, but throws if the record can't be saved. */
  async createOrFindByOrThrow(attributes: Partial<AttributesOf<M>>, init?: Init<M>): Promise<M> {
    return this.createOrThrow(attributes, init).catch((error) =>
      this.#findAfterClash(error, attributes),
    );
  }

  /** The record a unique index kept a create of `attributes` from duplicating. */
  async #findAfterClash(error: unknown, attributes: Partial<AttributesOf<M>>): Promise<M> {
    if (!(error instanceof RecordNotUnique)) throw error;
    return this.findByOrThrow(attributes);
  }

  /** Like `findBy`, but throws `RecordNotFound` instead of returning null. */
  async findByOrThrow(conditions: Conditions<M> | SafeSql): Promise<M> {
    const record = await this.findBy(conditions);
    if (record === null) throw new RecordNotFound(`${this.#model.name} not found`);
    return record;
  }

  /** The first record by this Relation's order, or by primary key if it has none. */
  async first(): Promise<M | null> {
    const cached = this.#cached();
    if (cached !== undefined) return cached[0] ?? null;
    return oneInOrder(this.#runner, this.#query, finderOrder(this.#model, this.#query));
  }

  /**
   * The last record: the first in the reverse of every order direction. With `limit`/`offset`,
   * the last record of that page (loaded, then taken from the end).
   */
  async last(): Promise<M | null> {
    const cached = this.#cached();
    if (cached !== undefined) return cached.at(-1) ?? null;
    const { limit, offset } = this.#query;
    if (limit !== undefined || offset !== undefined) {
      const page = await this.#runner.load({
        ...this.#query,
        order: finderOrder(this.#model, this.#query),
      });
      return page.at(-1) ?? null;
    }
    return oneInOrder(
      this.#runner,
      this.#query,
      finderOrder(this.#model, this.#query).map(reversed),
    );
  }

  /** One record in whatever order D1 returns, or null. */
  async take(): Promise<M | null> {
    const cached = this.#cached();
    if (cached !== undefined) return cached[0] ?? null;
    return oneInOrder(this.#runner, this.#query, this.#query.order);
  }

  /** The number of matching records, or of non-null values of `attribute`. */
  async count(attribute?: keyof AttributesOf<M> & string): Promise<number> {
    return count(this.#valueSource(), attribute);
  }

  /** The total of `attribute`'s values over the records, leaving out NULLs; 0 with none. */
  async sum<K extends NumberAttribute<M> | SafeSql>(attribute: K): Promise<CalculatedValue<M, K>> {
    return (await runCalculation(this.#valueSource(), "sum", attribute)) as never;
  }

  /** The mean of `attribute`'s values over the records, leaving out NULLs; null with none. */
  async average(attribute: NumberAttribute<M> | SafeSql): Promise<number | null> {
    return (await runCalculation(this.#valueSource(), "average", attribute)) as number | null;
  }

  /** The least of `attribute`'s values over the records, leaving out NULLs; null with none. */
  async minimum<K extends OrderedAttribute<M> | SafeSql>(
    attribute: K,
  ): Promise<CalculatedValue<M, K, unknown> | null> {
    return (await runCalculation(this.#valueSource(), "minimum", attribute)) as never;
  }

  /** The greatest of `attribute`'s values over the records, leaving out NULLs; null with none. */
  async maximum<K extends OrderedAttribute<M> | SafeSql>(
    attribute: K,
  ): Promise<CalculatedValue<M, K, unknown> | null> {
    return (await runCalculation(this.#valueSource(), "maximum", attribute)) as never;
  }

  /**
   * The calculation `operation` names, of `attribute`: `calculate("sum", "total")` is
   * `sum("total")`, and `calculate("count")` is `count()`.
   */
  async calculate(operation: "count", attribute?: keyof AttributesOf<M> & string): Promise<number>;
  async calculate<K extends NumberAttribute<M> | SafeSql>(
    operation: "sum",
    attribute: K,
  ): Promise<CalculatedValue<M, K>>;
  async calculate(
    operation: "average",
    attribute: NumberAttribute<M> | SafeSql,
  ): Promise<number | null>;
  async calculate<K extends OrderedAttribute<M> | SafeSql>(
    operation: "minimum" | "maximum",
    attribute: K,
  ): Promise<CalculatedValue<M, K, unknown> | null>;
  async calculate(operation: Operation, attribute?: string | SafeSql): Promise<unknown> {
    const named = requireOperation(operation);
    if (named === "count") return count(this.#valueSource(), attribute as string | undefined);
    return runCalculation(this.#valueSource(), named, attribute as string | SafeSql);
  }

  /** Groups the rows by attributes or `sql` fragments, for each group's calculations (#345). */
  group<const G extends GroupTerms<M>>(...terms: G): GroupedRelation<M, G> {
    return grouped(this as Relation<M>, terms, (relation) => relation.#valueSource());
  }

  /** What `count`, `pluck` and the calculations read values from: this Relation's. */
  #valueSource(): ValueSource {
    return {
      query: this.#query,
      dialect: () => this.#dialect,
      runner: this.#runner,
      cached: () => this.#cached(),
    };
  }

  /**
   * The number of records, as Rails' `size`: a loaded association's (built records included)
   * without a query; otherwise a `COUNT(*)`, plus an association's unsaved built records.
   */
  async size(): Promise<number> {
    const cached = this.#cached();
    if (cached !== undefined) return cached.length;
    return (await this.count()) + this.#collection.unsavedCount();
  }

  /** Whether there are no records: a loaded association answers itself, else `!exists()`. */
  async isEmpty(): Promise<boolean> {
    const cached = this.#cached();
    if (cached !== undefined) return cached.length === 0;
    if (this.#collection.unsavedCount() > 0) return false;
    return !(await this.exists());
  }

  /** Whether there are any records: the opposite of `isEmpty()` (Rails' `any?`). */
  async hasAny(): Promise<boolean> {
    return !(await this.isEmpty());
  }

  /** Whether any record matches, optionally with extra conditions. */
  async exists(conditions?: Conditions<M> | SafeSql): Promise<boolean> {
    const relation = conditions === undefined ? this : this.where(conditions);
    const query = { ...relation.#query, limit: atMostOne(relation.#query.limit) };
    return (await this.#runner.rows(() => compileExists(this.#dialect, query))).length > 0;
  }

  /** Converted values of one attribute, or tuples of several, in this Relation's order. */
  async pluck<K extends keyof AttributesOf<M> & string>(
    attribute: K,
  ): Promise<AttributesOf<M>[K][]>;
  async pluck<
    const K extends readonly [
      keyof AttributesOf<M> & string,
      keyof AttributesOf<M> & string,
      ...(keyof AttributesOf<M> & string)[],
    ],
  >(...attributes: K): Promise<{ -readonly [I in keyof K]: AttributesOf<M>[K[I]] }[]>;
  async pluck(...attributes: string[]): Promise<unknown[]> {
    return pluck(this.#valueSource(), attributes);
  }

  /**
   * One page of records and its total, by this Relation's order or the primary key, in one
   * round trip (#100). With `count: false`, no `COUNT`: the page has no total.
   */
  async paginate(options: PageOptions & { count: false }): Promise<CountlessPage<M>>;
  async paginate(options?: PageOptions & { count?: true }): Promise<Page<M>>;
  async paginate(options: PageOptions): Promise<Page<M> | CountlessPage<M>>;
  async paginate(options: PageOptions = {}): Promise<Page<M> | CountlessPage<M>> {
    return paginate({ model: this.#model, query: this.#query, runner: this.#runner }, options);
  }

  /**
   * The SQL `toArray()` sends, and its bound values, without sending it (Rails' `to_sql`). Values
   * are never inlined into the SQL (ADR-0006), and none are redacted, filtered attributes included.
   */
  toSql(): QuerySql {
    return querySql(selectForToSql(this.#dialect, this.#model, this.#query));
  }

  /** Prints as `Relation<Model> { sql, params }`: the SELECT it would send, without sending it (#104). */
  [inspectCustom](depth: number, options: InspectOptions, inspect: Inspect): string {
    const compiled = selectForToSql(this.#dialect, this.#model, this.#query);
    return inspectRelation(this.#model.name, compiled, { depth, options, inspect });
  }

  async toArray(): Promise<M[]> {
    const cached = this.#cached();
    if (cached !== undefined) return [...cached];
    // Started before the query is sent, so a write that lands first keeps its rows out (#181).
    const keepIfCurrent = this.#collection.startFill?.<M>();
    if (keepIfCurrent === undefined) return this.#runner.load(this.#query);
    // Loaded for the owner in its order, then target primary-key order, as preloaded.
    const records = await this.#runner.load({
      ...this.#query,
      order: thenPrimaryKey(this.#model, this.#query),
    });
    return keepIfCurrent(records);
  }

  get #state(): RelationState<M> {
    const query = this.#query;
    return { executor: this.#executor, model: this.#model, query, collection: this.#collection };
  }

  get #dialect(): Executor["dialect"] {
    return this.#executor.dialect;
  }

  /** The owner's loaded records for this hasMany, if it has them. */
  #cached(): M[] | undefined {
    return this.#collection.loaded() as M[] | undefined;
  }

  /**
   * This Relation on its and `other`'s databases, which must be one when it runs (#93), and
   * clearing `other`'s owner's loaded collection too when a statement is built through it (#194).
   */
  #joining<T extends Model, O>(other: Relation<T, O>, method: string): Relation<M, S> {
    const executor = jointly(this.#executor, other.#executor, `${method} needs its relations`);
    const collection = alsoClearing(this.#collection, other.#collection);
    if (executor === this.#executor && collection === this.#collection) return this;
    const Class = this.constructor as new (...args: RelationArgs<M>) => Relation<M, S>;
    return new Class({ executor, model: this.#model, query: this.#query, collection });
  }

  /** @internal Runs a scope on this Relation, checking it returned a Relation of the same Model. */
  [applyScope](name: string, scope: Scope<M>, args: unknown[]): Relation<M> {
    const result: unknown = scope(this as Relation<M>, ...args);
    if (!(result instanceof Relation) || result.#model !== this.#model) {
      throw scopeResultError(this.#model, name);
    }
    // Its database and this one's must be one when it runs (#93), as for merge and or.
    return result.#joining(this, `${this.#model.name} scope "${name}"`) as Relation<M>;
  }

  /**
   * `relation` typed with its scope methods. Sound because every Relation is made by
   * `relationFor` (the constructor needs the internal Executor), whose class has them.
   */
  #scoped(relation: Relation<M, S>): Scoped<M, S> {
    return relation as unknown as Scoped<M, S>;
  }

  /** A copy with `changes` to its query. */
  #with(changes: Partial<QueryDescription>): Scoped<M, S> {
    return this.#describing({ ...this.#query, ...changes });
  }

  /** A Relation of this same class for `query`, so a Model's scope methods survive chaining. */
  #describing(query: QueryDescription): Scoped<M, S> {
    const Class = this.constructor as new (...args: RelationArgs<M>) => Scoped<M, S>;
    checkQuery(query);
    // A changed query no longer matches what the owner has loaded: the collection narrows.
    const collection = this.#collection.narrowed();
    return new Class({ executor: this.#executor, model: this.#model, query, collection });
  }
}

/** What a Relation is made from; opaque outside the library. */
interface RelationParts<M extends Model> {
  executor: Executor;
  model: ModelClass<M>;
  query?: QueryDescription;
  collection?: OwnedCollection;
}

/** The Relation constructor's arguments, for the library's own `new`. */
export type RelationArgs<M extends Model> = [parts: RelationParts<M>];
