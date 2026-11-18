// A hasMany's counter cache on its owner (#61): the target's belongsTo that keeps one, and what removing records through the association counts out.
import { attributeFor } from "./attribute.ts";
import { compileCount } from "./compiler.ts";
import { touchAssignments } from "./counters.ts";
import {
  addToCount,
  compileCounterChange,
  countersOf,
  keyed,
  type Counter,
  type SqlPart,
} from "./counter-caches.ts";
import { valueMark } from "./dialect.ts";
import { modelOf, type Model } from "./model.ts";
import { quoteIdentifier } from "./query-tables.ts";
import type { QueryDescription } from "./query.ts";
import { state } from "./record-state.ts";
import { queryOf } from "./relation.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";
import { runAlone, Statement, statementParts } from "./statement.ts";

/**
 * The counter cache a hasMany's records are counted in on its owner, as Rails'
 * `has_cached_counter?` finds it: the target's belongsTo with the same foreign key (and with `as`,
 * the owner's type) whose counter cache is on the owner's Model, or one it extends.
 */
function ownersCounter(association: ResolvedAssociation): Counter | undefined {
  if (found.has(association)) return found.get(association);
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
  found.set(association, counter);
  return counter;
}

/** Each hasMany's counter cache, once found. Derived from the classes only. */
const found = new WeakMap<ResolvedAssociation, Counter | undefined>();

/**
 * How many records `owner`'s hasMany has by its counter cache, read as Rails reads it (`null` is
 * 0); undefined without one, while it's `active: false`, or when the owner's counter wasn't loaded
 * (left out of `select`).
 */
export function ownersCount(owner: Model, association: ResolvedAssociation): number | undefined {
  const counter = ownersCounter(association);
  const ownerState = owner[state];
  if (counter?.isActive !== true || !(counter.attribute in ownerState.attributes())) {
    return undefined;
  }
  return Number(ownerState.read(counter.attribute) ?? 0);
}

/**
 * `statement`, which removes the rows `query` matches from `owner`'s hasMany (deleting them, or
 * nullifying their key), with the owner's counter decremented first by how many rows it matches,
 * in the same batch, as Rails' collection `delete_all` does; once written, a loaded owner's
 * counter changes by how many it removed. Without a counter cache, `statement` itself.
 */
export function countedOut(
  statement: Statement,
  owner: Model,
  association: ResolvedAssociation,
  query: QueryDescription,
): Statement {
  const counter = ownersCounter(association);
  if (counter === undefined) return statement;
  const { executor } = statement[statementParts];
  const count = compileCount(executor.dialect, query);
  const change = { sql: `- (${count.sql})`, params: [...count.params] };
  const key = keyed(counter, owner[state].read(counter.targetKey));
  const decrement = compileCounterChange(counter, change, key);
  return statement.withFirst([decrement], (results) => {
    const removed = results.reduce((sum, { rowsAffected }) => sum + rowsAffected, 0);
    addToCount(owner, counter.attribute, -removed);
  });
}

/**
 * Sets `record`'s counter caches to how many records each named hasMany has, each counted by the
 * association's own query, scope included, as Rails' `reset_counters` counts: one UPDATE for
 * each, sent together, so each count is the one at the write.
 */
export async function resetCounters(
  record: Model,
  names: readonly string[],
  touch: unknown,
): Promise<void> {
  const model = modelOf(record);
  const resets = new Map<string, SqlPart>();
  for (const name of names) {
    const [attribute, reset] = counterReset(record, name);
    // Two names for one counter set it once: a column can't be assigned twice.
    if (!resets.has(attribute)) resets.set(attribute, reset);
  }
  const sets = [...resets.values()].map(({ sql }) => sql);
  const params = [...resets.values()].flatMap((reset) => reset.params);
  for (const [name, now] of touchAssignments(model, touch, "resetCounters")) {
    const attribute = attributeFor(model, name);
    attribute.bind(params, now);
    sets.push(`${quoteIdentifier(attribute.column)} = ${valueMark}`);
  }
  const key = attributeFor(model, model.primaryKey);
  key.bindCells(params, record[state].storedKey);
  const sql = `UPDATE ${quoteIdentifier(model.table)} SET ${sets.join(", ")} WHERE ${quoteIdentifier(key.column)} = ${valueMark}`;
  await runAlone(new Statement(record[state].executor, [{ sql, params, model }]));
}

/** `counter = (SELECT COUNT(*) …)` for `record`'s hasMany `name`, with the counter it sets. */
function counterReset(record: Model, name: string): [string, SqlPart] {
  const model = modelOf(record);
  const association = resolveAssociation(model, name);
  const counter = ownersCounter(association);
  if (counter === undefined) {
    throw new TypeError(
      `${model.name}.resetCounters: "${name}" has no counter cache on ${model.name}`,
    );
  }
  const { executor } = record[state];
  const rows = association.linkedTo(executor, association.keyOf(record));
  const count = compileCount(executor.dialect, rows[queryOf]);
  const column = quoteIdentifier(attributeFor(model, counter.attribute).column);
  return [counter.attribute, { sql: `${column} = (${count.sql})`, params: [...count.params] }];
}
