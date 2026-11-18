// Counter caches (#61): a belongsTo's `counterCache`, kept up to date by statements written in the same atomic batch as its record's insert, update or delete.
import { associationsOf } from "./association-fields.ts";
import type { AssociationDefinition } from "./associations.ts";
import { attributeFor } from "./attribute.ts";
import type { CompiledSql } from "./compiler.ts";
import { valueMark } from "./dialect.ts";
import { pluralize } from "./inflections.ts";
import { InvalidModel } from "./errors.ts";
import { modelOf, type Model, type ModelClass } from "./model.ts";
import { quoteIdentifier } from "./query-tables.ts";
import { state } from "./record-state.ts";
import { isOnDifferentDatabases, resolveAssociation } from "./resolved-association.ts";
import { tableOwnerModelName } from "./table-names.ts";

/**
 * The counter a belongsTo's `counterCache` keeps on its target: the attribute it names, or by
 * Rails' convention the owner's plural name + `Count` (`Reply` → `repliesCount`).
 */
function counterAttribute(owner: ModelClass, { counterCache }: AssociationDefinition): string {
  if (typeof counterCache === "string") return counterCache;
  const plural = pluralize(tableOwnerModelName(owner));
  return `${plural.charAt(0).toLowerCase()}${plural.slice(1)}Count`;
}

/**
 * A counter cache is a belongsTo's, and names, or infers, an attribute of each Model it points at.
 */
export function checkCounterCache(
  label: string,
  owner: ModelClass,
  definition: AssociationDefinition,
  targets: readonly ModelClass[],
): void {
  const { counterCache, kind } = definition;
  if (counterCache === undefined) return;
  if (kind !== "belongsTo") {
    throw new InvalidModel(`${label}: only a belongsTo keeps a counter cache`);
  }
  if (counterCache !== true && typeof counterCache !== "string") {
    const names = targets.map((target) => target.name).join(" or ");
    throw new InvalidModel(`${label}: counterCache takes true or the name of ${names}'s attribute`);
  }
  // Its count is written in the record's batch, so it can't be on another database (#489).
  const elsewhere = targets.find((target) => isOnDifferentDatabases(owner, target));
  if (elsewhere !== undefined) {
    throw new InvalidModel(
      `${label} keeps a counter cache on another database, which it can't yet: ${owner.name} and ${elsewhere.name} must be on one`,
    );
  }
  const attribute = counterAttribute(owner, definition);
  const hint =
    counterCache === true
      ? `counterCache: true infers it from ${owner.name}; declare it, or name another`
      : "check counterCache";
  for (const target of targets) {
    if (target.attributeDefinitions.has(attribute)) continue;
    throw new InvalidModel(`${label}: ${target.name} has no attribute "${attribute}" (${hint})`);
  }
}

/** One belongsTo's counter cache: the target's attribute it keeps, and how records link to it. */
interface Counter {
  /** The owner's foreign key. */
  foreignKey: string;
  target: ModelClass;
  /** The target's attribute holding the count. */
  attribute: string;
  /** The target's attribute the foreign key points at. */
  targetKey: string;
}

/** The counter caches a Model's records keep, one per belongsTo declaring one. */
function countersOf(owner: ModelClass): Counter[] {
  return [...associationsOf(owner)].flatMap(([name, definition]) => {
    if (definition.kind !== "belongsTo" || definition.counterCache === undefined) return [];
    const { target, targetAttribute } = resolveAssociation(owner, name);
    const attribute = counterAttribute(owner, definition);
    return [{ foreignKey: definition.foreignKey, target, attribute, targetKey: targetAttribute }];
  });
}

/** The statements that count a new record in: one per counter cache whose key is set. */
export function counterIncrements(record: Model): CompiledSql[] {
  return countersOf(modelOf(record)).flatMap((counter) => {
    const key = record[state].read(counter.foreignKey);
    return key === null || key === undefined ? [] : [counterChangeFor(counter, key, 1)];
  });
}

/**
 * The statements that count a record out, sent before its row is deleted: each finds its target
 * through the stored row, so a row already gone counts nothing, and a key changed in the database
 * since the record was read counts out the target it has now.
 */
export function counterDecrements(record: Model): CompiledSql[] {
  const owner = modelOf(record);
  const skipped = destroyedThrough.get(record);
  const counters = countersOf(owner).filter(({ foreignKey }) => foreignKey !== skipped);
  return counters.map((counter) => changeThroughRow(record, counter, -1, "before"));
}

/**
 * The statements that move a record's count when its foreign key changes: out of the target its
 * stored row points at before the UPDATE, and into the one it points at after it, so a row that
 * isn't there counts nothing.
 */
export function counterMoves(record: Model): { before: CompiledSql[]; after: CompiledSql[] } {
  const recordState = record[state];
  const moved = countersOf(modelOf(record)).filter(({ foreignKey }) =>
    recordState.isAttributeChanged(foreignKey),
  );
  return {
    before: moved.map((counter) => changeThroughRow(record, counter, -1, "before")),
    after: moved.map((counter) => changeThroughRow(record, counter, 1, "after")),
  };
}

/**
 * `counter`'s change by `by` on the target the record's row points at, found by the row's key
 * `before` its write, or `after` it (its key as the record holds it, should the write change it).
 */
function changeThroughRow(
  record: Model,
  counter: Counter,
  by: number,
  when: "before" | "after",
): CompiledSql {
  const owner = modelOf(record);
  const recordState = record[state];
  const params: unknown[] = [by];
  const ownerKey = attributeFor(owner, owner.primaryKey);
  if (when === "before") ownerKey.bindCells(params, recordState.storedKey);
  else ownerKey.bind(params, recordState.read(owner.primaryKey));
  const foreignKey = quoteIdentifier(attributeFor(owner, counter.foreignKey).column);
  const row = `(SELECT ${foreignKey} FROM ${quoteIdentifier(owner.table)} WHERE ${quoteIdentifier(ownerKey.column)} = ${valueMark})`;
  return compileCounterChange(counter, row, params);
}

/**
 * The foreign key of the association each record is being destroyed through, by its owner's
 * `dependent: "destroy"`: that owner is deleted with it, so its counter isn't changed, as Rails
 * skips it (`destroyed_by_association`). Not request state: set only while a destroy is prepared.
 */
const destroyedThrough = new WeakMap<Model, string>();

/** Prepares `record`'s destroy through its owner's association, whose `foreignKey` is given. */
export async function destroyingThrough<T>(
  record: Model,
  foreignKey: string,
  prepare: () => Promise<T>,
): Promise<T> {
  destroyedThrough.set(record, foreignKey);
  try {
    return await prepare();
  } finally {
    destroyedThrough.delete(record);
  }
}

/** `UPDATE … SET counter = COALESCE(counter, 0) + ? WHERE key = ?`, as Rails' `update_counters`. */
function counterChangeFor(counter: Counter, key: unknown, by: number): CompiledSql {
  const params: unknown[] = [by];
  attributeFor(counter.target, counter.targetKey).bind(params, key);
  return compileCounterChange(counter, valueMark, params);
}

/**
 * `UPDATE … SET counter = COALESCE(counter, 0) + ? WHERE key = <keyed>`, with `params` holding
 * the change, then `keyed`'s own values.
 */
function compileCounterChange(
  { target, attribute, targetKey }: Counter,
  keyed: string,
  params: unknown[],
): CompiledSql {
  const column = quoteIdentifier(attributeFor(target, attribute).column);
  const keyColumn = quoteIdentifier(attributeFor(target, targetKey).column);
  return {
    sql: `UPDATE ${quoteIdentifier(target.table)} SET ${column} = COALESCE(${column}, 0) + ${valueMark} WHERE ${keyColumn} = ${keyed}`,
    params,
    model: target,
  };
}
