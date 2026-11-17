// Finding or creating a record (#346): `findOrCreateBy` and the others, whose attributes both find a record and become a new one's values, so they refuse what a find reads as a condition (#433).
import { Comparison } from "./comparisons.ts";
import { attributeFor, noMatch } from "./attribute.ts";
import type { AttributesOf, Model, ModelClass } from "./model.ts";
import { createOrFindThrough, initializeThrough, type Init } from "./record-creation.ts";
import type { RelationState } from "./relation-state.ts";
import { column, SafeSql, sql } from "./sql.ts";

type Attributes<M> = Partial<AttributesOf<M>>;

/** What finds a record: a Relation, narrowed by fragments for arrays that are one value. */
interface Finder<M extends Model> {
  where(fragment: SafeSql): Finder<M>;
  findBy(attributes: Attributes<M>): Promise<M | null>;
  findByOrThrow(attributes: Attributes<M>): Promise<M>;
}

/** @internal What a find-or-create method works through: its Relation, and the method's name. */
export interface FindOrCreateCall<M extends Model> {
  readonly relation: Finder<M> & {
    create(attributes: Attributes<M>, init?: Init<M>): Promise<M>;
    createOrThrow(attributes: Attributes<M>, init?: Init<M>): Promise<M>;
  };
  readonly state: RelationState<M>;
  readonly method: FindOrCreateMethod;
}

/** @internal The find-or-create methods, which a refusal names. */
export type FindOrCreateMethod =
  | "findOrCreateBy"
  | "findOrCreateByOrThrow"
  | "findOrInitializeBy"
  | "createOrFindBy"
  | "createOrFindByOrThrow";

/** @internal What a find-or-create method's caller passes besides its attributes. */
export interface FindOrCreateOptions<M> {
  readonly init: Init<M> | undefined;
  readonly orThrow: boolean;
}

/** @internal `findOrCreateBy` and `findOrCreateByOrThrow`: the record found, or one created. */
export async function findOrCreate<M extends Model>(
  call: FindOrCreateCall<M>,
  attributes: Attributes<M>,
  { init, orThrow }: FindOrCreateOptions<M>,
): Promise<M> {
  const found = await findExisting(call, attributes);
  if (found !== null) return found;
  return orThrow
    ? call.relation.createOrThrow(attributes, init)
    : call.relation.create(attributes, init);
}

/** @internal `findOrInitializeBy`: the record found, or one built, its `init` awaited. */
export async function findOrInitialize<M extends Model>(
  call: FindOrCreateCall<M>,
  attributes: Attributes<M>,
  init: Init<M> | undefined,
): Promise<M> {
  return (await findExisting(call, attributes)) ?? initializeThrough(call.state, attributes, init);
}

/** @internal `createOrFindBy` and `createOrFindByOrThrow`: a record created, or the one a unique index kept. */
export async function createOrFind<M extends Model>(
  call: FindOrCreateCall<M>,
  attributes: Attributes<M>,
  options: FindOrCreateOptions<M>,
): Promise<M> {
  const { finder, conditions } = finderFor(call, attributes);
  const find = () => finder.findByOrThrow(conditions);
  return createOrFindThrough(call.state, attributes, { ...options, find });
}

/** The record with `attributes`, or null: what `findOrCreate` and `findOrInitialize` find. */
function findExisting<M extends Model>(
  call: FindOrCreateCall<M>,
  attributes: Attributes<M>,
): Promise<M | null> {
  const { finder, conditions } = finderFor(call, attributes);
  return finder.findBy(conditions);
}

/**
 * What finds the record with `attributes`, once they're checked: the Relation, narrowed by an
 * array the attribute casts as one value, compared whole, as the new record holds it, where `findBy` would
 * read it as a list; and the other attributes, as `findBy` reads them. They're copied as own
 * keys, so a `__proto__` key from parsed JSON stays an attribute `findBy` refuses.
 */
function finderFor<M extends Model>(
  call: FindOrCreateCall<M>,
  attributes: Attributes<M>,
): { finder: Finder<M>; conditions: Attributes<M> } {
  const entries = refuseConditionValues(call, attributes);
  let finder: Finder<M> = call.relation;
  for (const [name, value] of entries) {
    if (Array.isArray(value)) {
      finder = finder.where(sql`${column(name)} = ${column(name).value(value)}`);
    }
  }
  const conditions = Object.fromEntries(entries.filter(([, value]) => !Array.isArray(value)));
  return { finder, conditions: conditions as Attributes<M> };
}

/**
 * Throws `TypeError`, before anything is sent, for attributes a find would read as a condition
 * but a new record can't take as its values: a list (except an array the attribute casts as one value), which
 * `findBy` reads as `IN`, so input that skipped `permit` can't match another user's row; a
 * comparison; a `sql` fragment, as the attributes or as one value; or anything but an object,
 * whose missing attributes would find any record. The value isn't shown, as it may be filtered.
 * Returns the attributes' entries, read once.
 */
function refuseConditionValues(
  { state, method }: FindOrCreateCall<Model>,
  attributes: unknown,
): [string, unknown][] {
  const named = `${state.model.name}.${method}()`;
  if (attributes instanceof SafeSql) {
    throw new TypeError(`${named} takes attribute values, not a sql fragment`);
  }
  if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) {
    throw new TypeError(`${named} takes an object of attribute values`);
  }
  const entries = Object.entries(attributes);
  for (const [name, value] of entries) {
    const kind = conditionKind(state.model, name, value);
    if (kind === undefined) continue;
    throw new TypeError(
      `${named}: "${name}" can't be ${kind}, since it becomes the new record's value`,
    );
  }
  return entries;
}

/**
 * What a condition `value` of the attribute `name` is, when it's one a new record can't take as
 * its value. An array the attribute casts as one value is one: a json attribute's, or a custom
 * type's whose values are arrays.
 */
function conditionKind(model: ModelClass, name: string, value: unknown): string | undefined {
  if (Array.isArray(value)) return isOneValue(model, name, value) ? undefined : "a list";
  if (value instanceof Comparison) return "a comparison";
  if (value instanceof SafeSql) return "a sql fragment";
  return undefined;
}

/** Whether the attribute `name` casts the array `value` as one value, not as a list of them. */
function isOneValue(model: ModelClass, name: string, value: readonly unknown[]): boolean {
  return attributeFor(model, name).condition(value) !== noMatch;
}
