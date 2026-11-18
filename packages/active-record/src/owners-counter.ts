// A hasMany's counter cache on its owner (#61): the target's belongsTo that keeps one, and what removing records through the association counts out.
import { attributeFor } from "./attribute.ts";
import { compileCount } from "./compiler.ts";
import { touchAssignments } from "./counters.ts";
import {
  addToCount,
  compileCounterChange,
  countersOf,
  keyed,
  type CounterCache,
  type SqlPart,
} from "./counter-caches.ts";
import { valueMark } from "./dialect.ts";
import type { Model, ModelClass, QueryableClass } from "./model.ts";
import { quoteIdentifier } from "./query-tables.ts";
import type { QueryDescription } from "./query.ts";
import { state } from "./record-state.ts";
import { queryOf } from "./relation.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";
import type { StatementResult } from "./driver.ts";
import { rowsAffectedOf, runAlone, Statement, statementParts } from "./statement.ts";

/**
 * The counter cache a hasMany's records are counted in on its owner, as Rails'
 * `has_cached_counter?` finds it: the target's belongsTo with the same foreign key (and with `as`,
 * the owner's type) whose counter cache is on the owner's Model, or one it extends.
 */
function ownersCounter(association: ResolvedAssociation): CounterCache | undefined {
  if (countersByHasMany.has(association)) return countersByHasMany.get(association);
  const { owner, target, definition, type, hops } = association;
  const counter =
    definition.kind !== "hasMany" || hops !== undefined
      ? undefined
      : countersOf(target).find(
          (each) =>
            each.foreignKey === definition.foreignKey &&
            (owner === each.target || owner.prototype instanceof each.target) &&
            each.type?.value === type?.value,
        );
  countersByHasMany.set(association, counter);
  return counter;
}

/**
 * The counter cache a hasMany reads for `size`, as Rails' `has_cached_counter?`: the one its
 * records keep (`ownersCounter`), when it's the attribute named for the association (`replies` →
 * `repliesCount`), or its `counterCache`. So a hasMany narrowed by a scope, under another name,
 * counts its rows rather than reading a count of them all.
 */
function readCounter(association: ResolvedAssociation): CounterCache | undefined {
  const counter = ownersCounter(association);
  const { counterCache } = association.definition;
  const named = typeof counterCache === "string" ? counterCache : `${association.name}Count`;
  return counter?.attribute === named && counter.isActive ? counter : undefined;
}

/** Each hasMany's counter cache, once found. Derived from the classes only. */
const countersByHasMany = new WeakMap<ResolvedAssociation, CounterCache | undefined>();

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
 * nullifying their key), with the owner's counter taken down by how many it removes, in the same
 * batch, as Rails' collection `delete_all` does: in one statement where the dialect can count the
 * removed rows (Postgres), or by a COUNT of the rows `query` matches sent just before it. Once
 * written, a loaded owner's counter changes by how many it removed. Without a counter cache,
 * `statement` itself.
 */
export function countedOut(
  statement: Statement,
  owner: Model,
  association: ResolvedAssociation,
  query: QueryDescription,
): Statement {
  const counter = ownersCounter(association);
  if (counter === undefined) return statement;
  const { executor, queries, landed } = statement[statementParts];
  const key = keyed(counter, owner[state].read(counter.targetKey));
  const decrement = (removed: SqlPart) => compileCounterChange(counter, removed, key);
  const countOut = (results: readonly StatementResult[]) =>
    addToCount(owner, counter.attribute, -rowsAffectedOf(results));
  const [removal] = queries;
  const { dialect } = executor;
  if (dialect.countedRemoval !== undefined && queries.length === 1 && removal !== undefined) {
    const counted = dialect.countedRemoval(removal, (removed) =>
      decrement({ sql: `- ${removed}`, params: [] }),
    );
    return new Statement(executor, [counted], (results) => {
      landed(results);
      countOut(results);
    });
  }
  const count = compileCount(executor.dialect, query);
  const before = decrement({ sql: `- (${count.sql})`, params: [...count.params] });
  return statement.precededBy([before], countOut);
}

/**
 * `Model.resetCounters(id, names, { touch })`: checks the names and `touch`, finds the record
 * (`RecordNotFound`, as `find`), then sets each named hasMany's counter cache to a COUNT of its
 * records, and any touched attributes, in one UPDATE, so each count is the one at the write.
 */
export async function resetCounters(
  model: QueryableClass,
  id: unknown,
  names: string | readonly string[],
  touch: unknown,
): Promise<void> {
  const counted = countedBy(model, typeof names === "string" ? [names] : names);
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
 * The hasManys `names` reset, by the counter each sets, checked before anything is read: each
 * keeps a counter cache, and has no scope, whose rows wouldn't be all the counter counts (Rails
 * would write them in). Two names for one counter set it once: a column can't be assigned twice.
 */
function countedBy(model: ModelClass, names: readonly string[]): Map<string, ResolvedAssociation> {
  if (names.length === 0) {
    throw new TypeError(`${model.name}.resetCounters needs at least one association`);
  }
  const counted = new Map<string, ResolvedAssociation>();
  for (const name of names) {
    const association = resolveAssociation(model, name);
    const counter = ownersCounter(association);
    const refusal =
      counter === undefined
        ? `has no counter cache on ${model.name}`
        : association.definition.scope === undefined
          ? undefined
          : `has a scope, so it can't count ${counter.attribute}`;
    if (refusal !== undefined)
      throw new TypeError(`${model.name}.resetCounters: "${name}" ${refusal}`);
    if (!counted.has(counter!.attribute)) counted.set(counter!.attribute, association);
  }
  return counted;
}
