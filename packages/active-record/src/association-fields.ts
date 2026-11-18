// `belongsTo`, `hasMany`, and `hasOne`: the field declarations, reading a Model's from them, and reading a record's through its accessor.
import type {
  AssociationDeclaration,
  AssociationDefinition,
  AssociationKind,
  AssociationOptions,
  BelongsTo,
  HasMany,
  HasManyDependent,
  HasManyThrough,
  HasOne,
  HasOneDependent,
  HasOneThrough,
  ThroughDependent,
  ThroughOptions,
  PolymorphicBelongsTo,
} from "./associations.ts";
import { NoDatabase, UnknownAssociation } from "./errors.ts";
import { withForeignKeys } from "./foreign-keys.ts";
import type { AttributesOf, Model, ModelClass } from "./model.ts";
import { tableOwnerModelName } from "./table-names.ts";

/**
 * How many `newRecord` calls are constructing a record now. Module-level, but not request state
 * (ADR-0003): it's back to 0 before `newRecord` returns, with no await in between.
 */
let makingRecords = 0;

/** A field's accessor on a record constructed directly: it and its methods throw `NoDatabase`. */
function throwingField(): () => never {
  const field = () => {
    throw new NoDatabase(
      "this record was constructed directly (new …); build or load records through db.model(…) to use its associations",
    );
  };
  return Object.assign(field, { set: field, build: field, create: field, createOrThrow: field });
}

/**
 * Every association field's value while `newRecord` constructs a record. That record's fields are
 * removed, but one constructed directly meanwhile (`new Other()` in a field initializer) keeps
 * them, so it throws as a real field does.
 */
const placeholderField = Object.freeze(throwingField());

/** Marks a record field's value as an association declaration, and holds it. */
const declarationKey = Symbol("d1-record association");

/**
 * An association declaration, as a record field's value: `posts = hasMany(Post)`. Its
 * type is the accessor's, so TypeScript knows `user.posts()` with no `declare` line (ADR-0008).
 * Records from `build()` and queries get the real accessor; on a record constructed directly
 * (`new User()`), calling the field throws `NoDatabase`, as any database operation does.
 */
function declaration<A>(
  kind: AssociationKind,
  target: ModelClass | readonly ModelClass[],
  options: object,
): A {
  // A field newRecord removes straight away: nothing reads it, so nothing is built for it (#91).
  if (makingRecords > 0) return placeholderField as A;
  const field = throwingField();
  // The target's class is passed directly (no `() => Post`): a field's initializer runs when a
  // record is made, by which time every Model class exists, in whatever order they're declared.
  return Object.assign(field, { [declarationKey]: { kind, ...targetOf(target), ...options } }) as A;
}

/** A declaration's target: one Model, or a polymorphic belongsTo's list of them (#60). */
function targetOf(
  target: ModelClass | readonly ModelClass[],
): Pick<AssociationDeclaration, "target" | "targets"> {
  if (!Array.isArray(target)) return { target: () => target as ModelClass };
  const targets = [...(target as readonly ModelClass[])];
  return { target: noSingleTarget, targets: () => targets };
}

/** A polymorphic belongsTo's `target`: it has none, so reaching for one is the library's mistake. */
function noSingleTarget(): never {
  throw new Error("A polymorphic belongsTo has no single target; use the branch for a record");
}

/** One of the attributes of `C`'s records, which a counter cache names. */
type CounterName<C extends ModelClass> = keyof AttributesOf<InstanceType<C>> & string;

/** What only a belongsTo takes; `C` is its target, whose attribute a counter cache names. */
interface BelongsToOptions<C extends ModelClass = ModelClass> {
  /** The record may point at nothing: saving doesn't require its record (#339). */
  optional?: boolean;
  /**
   * Keeps a count of these records on the target (#61), updated in the same batch as each
   * write: `true` counts them in the attribute named for them (`Reply` → `repliesCount`), or name
   * another of the target's attributes (one every Model a polymorphic belongsTo lists has).
   * `{ attribute, active: false }` keeps it on writes, but `size` doesn't read it yet, so it
   * can be filled in for the rows already there (Rails 7.2's `active: false`).
   */
  counterCache?: true | CounterName<C> | { attribute?: CounterName<C>; active?: false };
}

/**
 * What a polymorphic belongsTo takes (#60): no `scope` (#436), and the attribute holding the
 * type, inferred as the association's name + `Type` (`commentable` → `commentableType`).
 */
export type PolymorphicBelongsToOptions<C extends ModelClass = ModelClass> = Omit<
  AssociationOptions,
  "dependent" | "scope"
> &
  BelongsToOptions<C> & { foreignType?: string };

/**
 * This record points at one record of one of `targets` (#60), by the type and key it holds:
 * `commentable = belongsTo([Post, Photo])`.
 */
export function belongsTo<L extends readonly [ModelClass, ...ModelClass[]]>(
  targets: L,
  options?: PolymorphicBelongsToOptions<L[number]>,
): PolymorphicBelongsTo<L[number]>;
/** This record points at one `target` record through `foreignKey` (its own attribute). */
export function belongsTo<C extends ModelClass>(
  target: C,
  options?: Omit<AssociationOptions<C>, "dependent"> & BelongsToOptions<C>,
): BelongsTo<C>;
export function belongsTo(
  target: ModelClass | readonly ModelClass[],
  options: object = {},
): unknown {
  return declaration("belongsTo", target, options);
}

/**
 * What only a hasMany or hasOne takes: `as`, the name of the target's polymorphic belongsTo
 * (#60), so its records point at this one by its type and key.
 */
interface ToPolymorphicOptions {
  /**
   * The target's polymorphic belongsTo this one is the other side of (#60): its records'
   * `${as}Type` holds this Model's name and `${as}Id` its key.
   */
  as?: string;
  /** The target's attribute holding the type, inferred from `as` (`commentableType`). */
  foreignType?: string;
}

/**
 * Many `target` records point at this record through `foreignKey` (theirs); or, with `through`,
 * this record reaches them through another of its associations (#59).
 */
export function hasMany<C extends ModelClass>(
  target: C,
  options: ThroughOptions<C> & { dependent?: ThroughDependent },
): HasManyThrough<C>;
export function hasMany<C extends ModelClass>(
  target: C,
  options?: AssociationOptions<C> & ToPolymorphicOptions & { dependent?: HasManyDependent },
): HasMany<C>;
export function hasMany<C extends ModelClass>(target: C, options: object = {}): unknown {
  return declaration("hasMany", target, options);
}

/**
 * One `target` record points at this record through `foreignKey` (its own); or, with
 * `through`, this record reaches it through another of its associations (#59).
 */
export function hasOne<C extends ModelClass>(
  target: C,
  options: ThroughOptions<C>,
): HasOneThrough<C>;
export function hasOne<C extends ModelClass>(
  target: C,
  options?: AssociationOptions<C> & ToPolymorphicOptions & { dependent?: HasOneDependent },
): HasOne<C>;
export function hasOne<C extends ModelClass>(target: C, options: object = {}): unknown {
  return declaration("hasOne", target, options);
}

/**
 * Each Model's associations, read once from a probe record's fields, with foreign keys given
 * or inferred. Module-level, but not request state (ADR-0003): derived only from the class.
 */
const definitions = new WeakMap<object, ReadonlyMap<string, AssociationDefinition>>();

/** One record of each Model, made once, to read its fields. Not request state (ADR-0003). */
const probes = new WeakMap<object, Model>();

/** A Model's probe record: its fields as declared, before any are removed. */
export function probeOf(model: ModelClass): Model {
  let probe = probes.get(model);
  if (probe === undefined) {
    // Its fields are read, so they're real declarations, even inside a newRecord (#91).
    const making = makingRecords;
    makingRecords = 0;
    try {
      probe = new model();
    } finally {
      makingRecords = making;
    }
    probes.set(model, probe);
  }
  return probe;
}

/** The declaration a field holds, if it's an association's. */
export function declarationIn(value: unknown): AssociationDeclaration | undefined {
  return typeof value === "function"
    ? (value as { [declarationKey]?: AssociationDeclaration })[declarationKey]
    : undefined;
}

/**
 * A Model's associations by name, in the order its fields declare them. A Map, so a name every
 * object inherits (`constructor`, from a URL's `?include=`) is never one (#84).
 */
export function associationsOf(model: ModelClass): ReadonlyMap<string, AssociationDefinition> {
  let found = definitions.get(model);
  if (found === undefined) {
    const probe = probeOf(model) as unknown as Record<string, unknown>;
    const declared: Record<string, AssociationDeclaration> = {};
    for (const name of Object.keys(probe)) {
      const field = declarationIn(probe[name]);
      if (field !== undefined) declared[name] = field;
    }
    found = new Map(Object.entries(withForeignKeys(declared, tableOwnerModelName(model))));
    definitions.set(model, found);
  }
  return found;
}

/**
 * A new record of `model`, its association fields removed so the accessors on the Model's
 * prototype answer instead. Removed newest first: when they're a record's last fields, as
 * they usually are, that undoes their additions and keeps the object's shape fast.
 */
export function newRecord<M extends Model>(model: ModelClass<M>): M {
  const record = constructWithoutAssociations(model);
  const names = [...associationsOf(model).keys()];
  for (let index = names.length - 1; index >= 0; index--) {
    delete (record as unknown as Record<string, unknown>)[names[index]!];
  }
  return record;
}

/** A record of `model` from its constructor, its association fields left as `placeholderField`. */
function constructWithoutAssociations<M extends Model>(model: ModelClass<M>): M {
  makingRecords++;
  try {
    return new model();
  } finally {
    makingRecords--;
  }
}

/** A Model's association by name; `UnknownAssociation` for any other name. */
export function associationOf(model: ModelClass, name: string): AssociationDefinition {
  const definition = associationsOf(model).get(name);
  if (definition === undefined) {
    throw new UnknownAssociation(`${model.name} has no association "${name}"`);
  }
  return definition;
}

/**
 * A record's association read through its accessor, as the app reads it (a query when it isn't
 * loaded): a hasMany's records, else its record or null.
 */
export async function readAssociation(
  record: Model,
  name: string,
): Promise<Model[] | Model | null> {
  const { kind } = associationOf(record.constructor as ModelClass, name);
  // The accessor installed for this association: a Relation for a hasMany, else a promise.
  const accessor = (record as unknown as Record<string, () => unknown>)[name]!;
  const read = accessor.call(record);
  if (kind === "hasMany") return (read as { toArray(): Promise<Model[]> }).toArray();
  return read as Promise<Model | null>;
}
