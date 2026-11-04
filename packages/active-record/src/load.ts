// How a Relation's query runs (on D1, or not at all for `none()`), and the keys `find` looks up.
import { attributeFor, noMatch } from "./attribute.ts";
import { compileColumns, compileCount, compileSelect, type CompiledSql } from "./compiler.ts";
import type { Dialect } from "./dialect.ts";
import { databaseNow, type Executor } from "./executor.ts";
import { stableOrder } from "./finder-order.ts";
import { hydrate, primaryKeyOf, type Model, type ModelClass } from "./model.ts";
import { keysForIncludes, planPreload } from "./preload.ts";
import type { QueryDescription } from "./query.ts";
import { sql } from "./sql.ts";

/**
 * How a Relation's query runs. The one place that knows a `none()` query never reaches D1: its
 * Relation's reads find nothing and its bulk writes change nothing, without a database.
 */
export interface QueryRunner<M extends Model> {
  /** The records `description` matches (one SELECT), hydrated, with its includes preloaded. */
  load(description: QueryDescription): Promise<M[]>;
  /** The records `description` matches and the number `counted` matches, sent as one batch. */
  loadCounted(description: QueryDescription, counted: QueryDescription): Promise<Counted<M>>;
  /**
   * The records `description` matches (one SELECT, its limit given), and whether more follow:
   * one row past the limit is read to learn that, and isn't hydrated or preloaded.
   */
  loadAhead(description: QueryDescription & { limit: number }): Promise<LoadedAhead<M>>;
  /** The rows of SQL other than loading records (a count, `exists`, `pluck`), compiled only to send it. */
  rows(sql: () => CompiledSql): Promise<Record<string, unknown>[]>;
  /** The rows `write` changed, running it now. */
  changes(write: () => Promise<{ rowsAffected: number }>): Promise<number>;
}

/** Records, and a count sent with them. */
interface Counted<M extends Model> {
  records: M[];
  count: number;
}

/** Records, and whether more follow them. */
interface LoadedAhead<M extends Model> {
  records: M[];
  hasMore: boolean;
}

/** How `query`, a Relation's, runs: on `executor`, unless it's a `none()` query. */
export function runnerFor<M extends Model>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription,
): QueryRunner<M> {
  if (query.none) return nothing;
  return {
    load: (description) => loadRecords(executor, model, description),
    loadCounted: (description, counted) => loadCounted(executor, model, description, counted),
    loadAhead: (description) => loadAhead(executor, model, description),
    rows: (sql) => executor.all(sql()),
    changes: async (write) => (await write()).rowsAffected,
  };
}

/** A `none()` query's runner: nothing is sent, so nothing is found or changed. */
const nothing: QueryRunner<never> = {
  load: async () => [],
  loadCounted: async () => ({ records: [], count: 0 }),
  loadAhead: async () => ({ records: [], hasMore: false }),
  rows: async () => [],
  changes: async () => 0,
};

/** One SELECT for `query`'s records, hydrated, with its includes preloaded. */
async function loadRecords<M extends Model>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription,
): Promise<M[]> {
  const own = (loaded: QueryDescription) => [selectFor(executor.dialect, model, loaded)];
  return (await loadWith(executor, model, { query, own, rowsOf: ([rows]) => rows })).records;
}

/** The count of `counted` and the SELECT for `query`'s records as one batch: one round trip. */
async function loadCounted<M extends Model>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription,
  counted: QueryDescription,
): Promise<Counted<M>> {
  const { dialect } = executor;
  const countSql = compileCount(dialect, counted);
  const own = (loaded: QueryDescription) => [countSql, selectFor(dialect, model, loaded)];
  const loaded = await loadWith(executor, model, { query, own, rowsOf: ([, rows]) => rows });
  const [countRows] = loaded.results;
  return { records: loaded.records, count: Number(countRows?.[0]?.["count"] ?? 0) };
}

/** One SELECT for `query`'s records and one past its limit, which is read but not loaded. */
async function loadAhead<M extends Model>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription & { limit: number },
): Promise<LoadedAhead<M>> {
  const own = (loaded: QueryDescription) => [
    selectFor(executor.dialect, model, { ...loaded, limit: query.limit + 1 }),
  ];
  const rowsOf = ([rows]: readonly Rows[]) => rows?.slice(0, query.limit);
  const { records, results } = await loadWith(executor, model, { query, own, rowsOf });
  return { records, hasMore: (results[0]?.length ?? 0) > query.limit };
}

/**
 * What a load sends of its own (its SELECT, and a count) for the query it loads, and which of
 * their rows are records.
 */
interface Load {
  query: QueryDescription;
  own: (query: QueryDescription) => readonly CompiledSql[];
  rowsOf: (results: readonly Rows[]) => readonly Record<string, unknown>[] | undefined;
}

/**
 * Sends a load's own statements and those preloading its query's includes together, in one
 * round trip, then makes its records and attaches the preloads. Resolves to the records and
 * the own statements' rows.
 */
async function loadWith<M extends Model>(
  executor: Executor,
  model: ModelClass<M>,
  load: Load,
): Promise<{ records: M[]; results: Rows[] }> {
  const query = withPreloadOrder(model, load.query);
  const own = load.own(query);
  const plan = query.includes === undefined ? undefined : planPreload(query, executor);
  const results = await sendTogether(executor, [...own, ...(plan?.statements ?? [])]);
  // Bound to the database the query used, which they keep, even past a request's withDatabase.
  const database = await databaseNow(executor);
  const records = (load.rowsOf(results) ?? []).map((row) => hydrate(model, row, database));
  await plan?.attach([records], results.slice(own.length), database);
  return { records, results: results.slice(0, own.length) };
}

/**
 * `query`, with its order ended by the primary key if it has includes and a limit or offset.
 * Its preloads select its keys with a subquery of it, so a total order makes them find the
 * records it loads: a limit could otherwise pick tied rows, or rows in no order, differently.
 */
function withPreloadOrder(model: ModelClass, query: QueryDescription): QueryDescription {
  if (query.includes === undefined) return query;
  if (query.limit === undefined && query.offset === undefined) return query;
  return { ...query, order: stableOrder(model, query) };
}

/** Rows D1 returned for one statement. */
export type Rows = Record<string, unknown>[];

/** The rows of each of `queries`, sent in one round trip. */
export async function sendTogether(
  executor: Executor,
  queries: readonly CompiledSql[],
): Promise<Rows[]> {
  const [only] = queries;
  if (queries.length === 1 && only !== undefined) return [await executor.all(only)];
  return (await executor.read(queries)).map((result) => result.rows);
}

/** The SELECT for `query`'s records. */
export function selectFor(
  dialect: Dialect,
  model: ModelClass,
  query: QueryDescription,
): CompiledSql {
  // A partial record keeps its primary key, so it keeps its identity — except after
  // distinct(), where adding the key would make every row distinct.
  const loaded =
    query.select && !query.distinct
      ? [...new Set([model.primaryKey, ...keysForIncludes(model, query.includes), ...query.select])]
      : query.select;
  return compileSelect(dialect, query, compileColumns(model, loaded));
}

/**
 * The SELECT `toSql()` shows for `query`. A `none()` query is never sent, so it shows what
 * matching nothing would be: its conditions and `1 = 0`.
 */
export function selectForToSql(
  dialect: Dialect,
  model: ModelClass,
  query: QueryDescription,
): CompiledSql {
  const never = sql`1 = 0`;
  return selectFor(
    dialect,
    model,
    query.none ? { ...query, conditions: [...query.conditions, never] } : query,
  );
}

/**
 * The primary keys `find(...)` looks up: each cast to the key's type as a condition is, then
 * each once, as Rails does. One that can't be cast stays as given, matches nothing, and is
 * reported missing.
 */
export function keysToFind(model: ModelClass, ids: readonly unknown[]): (string | number)[] {
  const key = attributeFor(model, model.primaryKey);
  const keys = ids.map((id) => {
    const cast = key.condition(id);
    return (cast === noMatch ? id : cast) as string | number;
  });
  return [...new Set(keys)];
}

/** Found `records` in the order of their primary keys in `keys`. */
export function inKeyOrder<M extends Model>(records: readonly M[], keys: readonly unknown[]): M[] {
  const byKey = new Map(records.map((record) => [primaryKeyOf(record), record]));
  return keys.map((key) => byKey.get(key) as M);
}
