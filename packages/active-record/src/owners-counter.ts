// A hasMany's counter cache on its owner (#61): the target's belongsTo that keeps one, and what removing records through the association counts out.
import { compileCount } from "./compiler.ts";
import {
  addToCount,
  compileCounterChange,
  countersOf,
  keyed,
  type Counter,
} from "./counter-caches.ts";
import type { Model } from "./model.ts";
import type { QueryDescription } from "./query.ts";
import { state } from "./record-state.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";
import { statementParts, type Statement } from "./statement.ts";

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
 * 0); undefined without one, or when the owner's counter wasn't loaded (left out of `select`).
 */
export function ownersCount(owner: Model, association: ResolvedAssociation): number | undefined {
  const counter = ownersCounter(association);
  const ownerState = owner[state];
  if (counter === undefined || !(counter.attribute in ownerState.attributes())) return undefined;
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
