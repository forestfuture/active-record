// Finding or creating a record (#346): `findOrCreateBy` and the others, whose attributes both find a record and become a new one's values, so they refuse what a find reads as a condition (#433).
import { Comparison } from "./comparisons.ts";
import { attributeFor } from "./attribute.ts";
import type { AttributesOf, Model, ModelClass } from "./model.ts";
import { createOrFindThrough, initializeThrough, type Init } from "./record-creation.ts";
import type { RelationState } from "./relation-state.ts";
import { column, SafeSql, sql } from "./sql.ts";

type Attributes<M> = Partial<AttributesOf<M>>;

/** What finds a record: a Relation, narrowed by fragments for json attributes' arrays. */
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
  readonly method: string;
}

/** @internal What a find-or-create method's caller passes besides its attributes. */
export interface CreateOptions<M> {
  readonly init: Init<M> | undefined;
  readonly orThrow: boolean;
}

/** @internal `findOrCreateBy` and `findOrCreateByOrThrow`: the record found, or one created. */
export async function findOrCreate<M extends Model>(
  call: FindOrCreateCall<M>,
  attributes: Attributes<M>,
  { init, orThrow }: CreateOptions<M>,
): Promise<M> {
  const found = await findGiven(call, attributes);
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
  return (await findGiven(call, attributes)) ?? initializeThrough(call.state, attributes, init);
}

/** @internal `createOrFindBy` and `createOrFindByOrThrow`: a record created, or the one a unique index kept. */
export async function createOrFind<M extends Model>(
  call: FindOrCreateCall<M>,
  attributes: Attributes<M>,
  options: CreateOptions<M>,
): Promise<M> {
  refuseConditionValues(call, attributes);
  const { finder, conditions } = finding(call.relation, attributes);
  const find = () => finder.findByOrThrow(conditions);
  return createOrFindThrough(call.state, attributes, { ...options, find });
}

function findGiven<M extends Model>(
  call: FindOrCreateCall<M>,
  attributes: Attributes<M>,
): Promise<M | null> {
  refuseConditionValues(call, attributes);
  const { finder, conditions } = finding(call.relation, attributes);
  return finder.findBy(conditions);
}

/**
 * What finds the record with `attributes`: a json attribute's array compared as one value, as
 * the new record holds it, where `findBy` would read it as a list, and the other attributes
 * as `findBy` reads them. Lists of other attributes are refused before this.
 */
function finding<M extends Model>(
  relation: Finder<M>,
  attributes: Attributes<M>,
): { finder: Finder<M>; conditions: Attributes<M> } {
  let finder = relation;
  const conditions: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (Array.isArray(value)) {
      finder = finder.where(sql`${column(name)} = ${column(name).value(value)}`);
    } else {
      conditions[name] = value;
    }
  }
  return { finder, conditions: conditions as Attributes<M> };
}

/**
 * Throws `TypeError`, before anything is sent, for attributes a find would read as a condition
 * but a new record can't take as its values: a list, which `findBy` reads as `IN`, so input that
 * skipped `permit` can't match another user's row; a comparison; or a `sql` fragment, as the
 * attributes or as one value. The value isn't shown, as it may be filtered.
 */
function refuseConditionValues(
  { state, method }: FindOrCreateCall<Model>,
  attributes: Readonly<Record<string, unknown>>,
): void {
  if (attributes instanceof SafeSql) {
    throw new TypeError(
      `${state.model.name}.${method}() takes attribute values, not a sql fragment`,
    );
  }
  for (const [name, value] of Object.entries(attributes)) {
    const kind = conditionKind(state.model, name, value);
    if (kind === undefined) continue;
    throw new TypeError(
      `${state.model.name}.${method}(): "${name}" can't be ${kind}, since it becomes the new record's value`,
    );
  }
}

/**
 * What a condition `value` of the attribute `name` is, when it's one a new record can't take as
 * its value. A json attribute's array is one value.
 */
function conditionKind(model: ModelClass, name: string, value: unknown): string | undefined {
  if (Array.isArray(value)) return attributeFor(model, name).isJson ? undefined : "a list";
  if (value instanceof Comparison) return "a comparison";
  if (value instanceof SafeSql) return "a sql fragment";
  return undefined;
}
