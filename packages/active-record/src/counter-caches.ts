// Counter caches (#61): a belongsTo's `counterCache`, kept up to date by statements written in the same atomic batch as its record's insert, update or delete.
import { associationsOf } from "./association-fields.ts";
import type { AssociationDefinition } from "./associations.ts";
import { attributeFor } from "./attribute.ts";
import type { CompiledSql } from "./compiler.ts";
import { valueMark } from "./dialect.ts";
import { pluralize } from "./inflections.ts";
import { InvalidModel } from "./errors.ts";
import { Model, modelOf, type ModelClass } from "./model.ts";
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

/**
 * One belongsTo's counter cache on one Model: the target's attribute it keeps, and how records
 * link to it. A polymorphic belongsTo has one for each Model it lists, by the type naming it (#60).
 */
interface Counter {
  /** The belongsTo's name. */
  name: string;
  /** The owner's foreign key. */
  foreignKey: string;
  target: ModelClass;
  /** The target's attribute holding the count. */
  attribute: string;
  /** The target's attribute the foreign key points at. */
  targetKey: string;
  /** A polymorphic belongsTo's type attribute, and the name it holds for this target. */
  type: { attribute: string; value: string } | undefined;
}

/** The counter caches a Model's records keep: each belongsTo's declaring one, on each target. */
function countersOf(owner: ModelClass): Counter[] {
  return [...associationsOf(owner)].flatMap(([name, definition]) => {
    if (definition.kind !== "belongsTo" || definition.counterCache === undefined) return [];
    const attribute = counterAttribute(owner, definition);
    const { foreignKey } = definition;
    return resolveAssociation(owner, name).branches.map(({ target, targetAttribute, type }) => ({
      name,
      foreignKey,
      target,
      attribute,
      targetKey: targetAttribute,
      type,
    }));
  });
}

/**
 * Whether the type a record holds, as `typeIn` reads it, names `counter`'s target: always, for
 * a belongsTo that isn't polymorphic.
 */
function isNamed(counter: Counter, typeIn: (attribute: string) => unknown): boolean {
  return counter.type === undefined || typeIn(counter.type.attribute) === counter.type.value;
}

/**
 * What a write does to its record's counter caches: statements sent before and after its own,
 * and what its loaded targets take on once the batch is written.
 */
export interface CounterChanges {
  before: CompiledSql[];
  after: CompiledSql[];
  commit(): void;
}

/** Counting a new record in: each counter cache whose key is set, on its target by that key. */
export function countersOnInsert(record: Model): CounterChanges {
  const recordState = record[state];
  const counted = countersOf(modelOf(record)).filter((counter) => {
    const key = recordState.read(counter.foreignKey);
    return key !== null && key !== undefined && isNamed(counter, (name) => recordState.read(name));
  });
  const after = counted.map((counter) =>
    counterChangeFor(counter, recordState.read(counter.foreignKey), 1),
  );
  return { before: [], after, commit: () => countLoaded(record, counted, 1) };
}

/**
 * Counting a record out, before its row is deleted: each finds its target through the stored
 * row, so a row already gone counts nothing, and a key changed in the database since the record
 * was read counts out the target it has now.
 */
export function countersOnDestroy(record: Model): CounterChanges {
  const recordState = record[state];
  const skipped = destroyedThrough.get(record);
  const counted = countersOf(modelOf(record)).filter(
    (counter) =>
      counter.foreignKey !== skipped &&
      isNamed(counter, (name) => recordState.valueInDatabase(name)),
  );
  const before = counted.map((counter) => changeThroughRow(record, counter, -1, "before"));
  return { before, after: [], commit: () => countLoaded(record, counted, -1) };
}

/**
 * Moving a record's count when its foreign key, or a polymorphic belongsTo's type, changes: out
 * of the target its stored row points at before the UPDATE, and into the one it points at after
 * it, so a row that isn't there counts nothing. A loaded new target counts it in memory, as
 * Rails' `increment!` does.
 */
export function countersOnUpdate(record: Model): CounterChanges {
  const recordState = record[state];
  const moved = countersOf(modelOf(record)).filter(({ foreignKey, type }) =>
    [foreignKey, type?.attribute].some(
      (name) => name !== undefined && recordState.isAttributeChanged(name),
    ),
  );
  const from = moved.filter((counter) =>
    isNamed(counter, (name) => recordState.valueInDatabase(name)),
  );
  const to = moved.filter((counter) => isNamed(counter, (name) => recordState.read(name)));
  return {
    before: from.map((counter) => changeThroughRow(record, counter, -1, "before")),
    after: to.map((counter) => changeThroughRow(record, counter, 1, "after")),
    commit: () => countLoaded(record, to, 1),
  };
}

/**
 * Each counter's target the record has loaded for its key takes the change, as stored: its
 * attribute, if loaded, changes by `by` and has no unsaved change, as after Rails' `increment!`.
 */
function countLoaded(record: Model, counters: readonly Counter[], by: number): void {
  for (const { name, attribute } of counters) {
    const target = record[state].associations.get(name)?.value;
    if (!(target instanceof Model)) continue;
    const targetState = target[state];
    if (targetState.isDestroyed || !(attribute in targetState.attributes())) continue;
    const count = targetState.read(attribute);
    targetState.write(attribute, (typeof count === "number" ? count : 0) + by);
    targetState.commitColumns([attribute]);
  }
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
  const typed =
    counter.type === undefined ? "" : ` AND ${typeCondition(owner, counter.type, params)}`;
  const row = `(SELECT ${foreignKey} FROM ${quoteIdentifier(owner.table)} WHERE ${quoteIdentifier(ownerKey.column)} = ${valueMark}${typed})`;
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

/** `type = ?`: a polymorphic row's type naming the counter's target, its value bound. */
function typeCondition(
  owner: ModelClass,
  { attribute, value }: NonNullable<Counter["type"]>,
  params: unknown[],
): string {
  const type = attributeFor(owner, attribute);
  type.bind(params, value);
  return `${quoteIdentifier(type.column)} = ${valueMark}`;
}
