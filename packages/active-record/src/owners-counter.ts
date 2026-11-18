// A hasMany's counter caches on its owner (#61): the counters its records' belongsTos keep there, the one it reads, what removing records through it counts out, and resetCounters.
import { attributeFor } from "./attribute.ts";
import { compileCount } from "./compiler.ts";
import { touchAssignments } from "./counters.ts";
import {
  addToCount,
  compileCountersChange,
  countersOf,
  keyed,
  type CounterCache,
  type SqlPart,
} from "./counter-caches.ts";
import { valueMark } from "./dialect.ts";
import { modelOf, type Model, type ModelClass, type QueryableClass } from "./model.ts";
import { quoteIdentifier } from "./query-tables.ts";
import type { QueryDescription } from "./query.ts";
import { state } from "./record-state.ts";
import { queryOf } from "./relation.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";
import type { StatementResult } from "./driver.ts";
import { rowsAffectedOf, runAlone, Statement, statementParts } from "./statement.ts";

/**
 * The counter caches a hasMany's records are counted in on its owner: those of the target's
 * belongsTos with the same foreign key pointing at the same key of the owner's Model, or one it
 * extends (and with `as`, naming the owner's type). Removing its records counts them out of each.
 */
function ownersCounters(association: ResolvedAssociation): readonly CounterCache[] {
  const known = countersByHasMany.get(association);
  if (known !== undefined) return known;
  const { owner, target, definition, type, hops, ownerAttribute } = association;
  const counters =
    definition.kind !== "hasMany" || hops !== undefined
      ? []
      : countersOf(target).filter(
          (each) =>
            each.foreignKey === definition.foreignKey &&
            each.targetKey === ownerAttribute &&
            (owner === each.target || owner.prototype instanceof each.target) &&
            each.type?.value === type?.value,
        );
  countersByHasMany.set(association, counters);
  return counters;
}

/**
 * The one of its counters a hasMany reads, as Rails' `has_cached_counter?`: the attribute named
 * for the association (`replies` → `repliesCount`), or its `counterCache`.
 */
function namedCounter(association: ResolvedAssociation): CounterCache | undefined {
  const { counterCache } = association.definition;
  const named = typeof counterCache === "string" ? counterCache : `${association.name}Count`;
  return ownersCounters(association).find((counter) => counter.attribute === named);
}

/**
 * The counter a hasMany reads for `size`: its `namedCounter`, while active. So a hasMany narrowed
 * by a scope, under another name, counts its rows rather than reading a count of them all.
 */
function readCounter(association: ResolvedAssociation): CounterCache | undefined {
  const counter = namedCounter(association);
  return counter?.isActive === true ? counter : undefined;
}

/** Each hasMany's counter caches, once found. Derived from the classes only. */
const countersByHasMany = new WeakMap<ResolvedAssociation, readonly CounterCache[]>();

/**
 * How many records `owner`'s hasMany has by its counter cache, read as Rails reads it (`null` is
 * 0); undefined without one, while it's `active: false`, or when the owner's counter wasn't loaded
 * (left out of `select`).
 */
export function ownersCount(owner: Model, association: ResolvedAssociation): number | undefined {
  const counter = readCounter(association);
  const ownerState = owner[state];
  if (counter?.isActive !== true || !(counter.attribute in ownerState.attributes())) {
    return undefined;
  }
  return Number(ownerState.read(counter.attribute) ?? 0);
}

/**
 * `statement`, which removes the rows `query` matches from `owner`'s hasMany (deleting them, or
 * nullifying their key), with each of the owner's counters taken down by how many it removes, in
 * the same batch, as Rails' collection `delete_all` does: in one statement where the dialect can
 * count the removed rows (Postgres) and the removal can't change the owner's row, or by a COUNT of
 * the rows `query` matches sent just before it. Once written, a loaded owner's counters change by
 * how many it removed. Without a counter cache, `statement` itself.
 */
export function countedOut(
  statement: Statement,
  owner: Model,
  association: ResolvedAssociation,
  query: QueryDescription,
): Statement {
  const counters = ownersCounters(association);
  if (counters.length === 0) return statement;
  const { executor, queries, landed } = statement[statementParts];
  // Every counter is on the owner's row, found by the hasMany's key: one UPDATE changes them all.
  const key = keyed(counters[0]!, owner[state].read(association.ownerAttribute));
  const decrements = (by: SqlPart) => [compileCountersChange(counters, by, key)];
  const countOut = (removed: number) => {
    for (const { attribute } of counters) addToCount(owner, attribute, -removed);
  };
  const [removal] = queries;
  const { dialect } = executor;
  const isOneStatement = queries.length === 1 && !isOwnRecord(owner, association);
  if (dialect.countedRemoval !== undefined && isOneStatement && removal) {
    const counted = dialect.countedRemoval(removal, (removedCount) =>
      decrements({ sql: `- ${removedCount}`, params: [] }),
    );
    const removedBy = (results: readonly StatementResult[]) =>
      Number(results[0]?.rows[0]?.["removed"] ?? 0);
    const counting = new Statement(executor, [counted], (results) => {
      landed(results);
      countOut(removedBy(results));
    });
    return counting.affecting(removedBy);
  }
  const count = compileCount(executor.dialect, query);
  return statement.precededBy(
    decrements({ sql: `- (${count.sql})`, params: count.params }),
    (results) => countOut(rowsAffectedOf(results)),
  );
}

/**
 * Whether removing `owner`'s records may change the owner's own row: a hasMany of its own table
 * whose owner is its own parent, or might be (its key isn't loaded). In one statement Postgres
 * changes a row once, so the counter's change and the removal can't both land; such a removal
 * counts first. Should the row become its own parent after it was read, the removal still comes
 * first in the statement, and only the count is missed.
 */
function isOwnRecord(owner: Model, { target, definition, ownerAttribute }: ResolvedAssociation) {
  if (target.table !== modelOf(owner).table) return false;
  const ownerState = owner[state];
  if (!(definition.foreignKey in ownerState.attributes())) return true;
  return ownerState.read(definition.foreignKey) === ownerState.read(ownerAttribute);
}

/**
 * `Model.resetCounters(id, names, { touch })`: checks the names and `touch`, finds the record
 * (`RecordNotFound`, as `find`), then sets each named hasMany's counter caches to a COUNT of its
 * records, and any touched attributes, in one UPDATE, so each count is the one at the write.
 */
export async function resetCounters(
  model: QueryableClass,
  id: unknown,
  names: string | readonly string[],
  touch: unknown,
): Promise<void> {
  const counted = countersToReset(model, typeof names === "string" ? [names] : names);
  const touched = touchAssignments(model, touch, "resetCounters");
  const record: Model = await model.all().find(id as never);
  const { executor } = record[state];
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [attribute, association] of counted) {
    const rows = association.linkedTo(executor, association.keyOf(record));
    const count = compileCount(executor.dialect, rows[queryOf]);
    sets.push(`${quoteIdentifier(attributeFor(model, attribute).column)} = (${count.sql})`);
    params.push(...count.params);
  }
  for (const [name, now] of touched) {
    const attribute = attributeFor(model, name);
    attribute.bind(params, now);
    sets.push(`${quoteIdentifier(attribute.column)} = ${valueMark}`);
  }
  const key = attributeFor(model, model.primaryKey);
  key.bindCells(params, record[state].storedKey);
  const sql = `UPDATE ${quoteIdentifier(model.table)} SET ${sets.join(", ")} WHERE ${quoteIdentifier(key.column)} = ${valueMark}`;
  await runAlone(new Statement(executor, [{ sql, params, model }]));
}

/**
 * The counters `names` reset, each by the hasMany whose records it counts, checked before anything
 * is read: each hasMany's records keep a counter cache, and it has no scope, whose rows wouldn't
 * be all a counter counts (Rails would write them in). Every counter on its key is reset, as a
 * bulk removal counts out of each; one named twice is set once, since a column takes one value.
 */
function countersToReset(
  model: ModelClass,
  names: readonly string[],
): Map<string, ResolvedAssociation> {
  if (names.length === 0) {
    throw new TypeError(`${model.name}.resetCounters needs at least one association`);
  }
  const reset = new Map<string, ResolvedAssociation>();
  for (const name of names) {
    const association = resolveAssociation(model, name);
    const counters = ownersCounters(association);
    const refuse = (why: string) => new TypeError(`${model.name}.resetCounters: "${name}" ${why}`);
    if (counters.length === 0) throw refuse(`has no counter cache on ${model.name}`);
    if (association.definition.scope !== undefined) {
      const counter = namedCounter(association) ?? counters[0]!;
      throw refuse(`has a scope, so it can't count ${counter.attribute}`);
    }
    for (const { attribute } of counters)
      if (!reset.has(attribute)) reset.set(attribute, association);
  }
  return reset;
}
