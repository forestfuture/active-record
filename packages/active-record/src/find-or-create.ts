// Finding or creating a record (#346): `findOrCreateBy` and the others, whose attributes both find a record and become a new one's values, so they refuse what a find reads as a condition (#433).
import { Comparison } from "./comparisons.ts";
import type { AttributesOf, Model } from "./model.ts";
import { createOrFindThrough, initializeThrough, type Init } from "./record-creation.ts";
import type { RelationState } from "./relation-state.ts";
import { SafeSql } from "./sql.ts";

type Attributes<M> = Partial<AttributesOf<M>>;

/** @internal What a find-or-create method works through: its Relation, and the method's name. */
export interface FindOrCreateCall<M extends Model> {
  readonly relation: {
    findBy(attributes: Attributes<M>): Promise<M | null>;
    findByOrThrow(attributes: Attributes<M>): Promise<M>;
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
  const find = () => call.relation.findByOrThrow(attributes);
  return createOrFindThrough(call.state, attributes, { ...options, find });
}

function findGiven<M extends Model>(
  call: FindOrCreateCall<M>,
  attributes: Attributes<M>,
): Promise<M | null> {
  refuseConditionValues(call, attributes);
  return call.relation.findBy(attributes);
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
    const kind = conditionKind(value);
    if (kind === undefined) continue;
    throw new TypeError(
      `${state.model.name}.${method}(): "${name}" can't be ${kind}, since it becomes the new record's value`,
    );
  }
}

/** What a condition `value` is, when it's one a new record can't take as its value. */
function conditionKind(value: unknown): string | undefined {
  if (Array.isArray(value)) return "a list";
  if (value instanceof Comparison) return "a comparison";
  if (value instanceof SafeSql) return "a sql fragment";
  return undefined;
}
