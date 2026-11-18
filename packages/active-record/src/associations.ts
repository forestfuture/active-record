// Association types and options, and readying a Model: its associations checked and installed.
import { InvalidModel } from "./errors.ts";
import { associationsOf } from "./association-fields.ts";
import {
  belongsToAccessor,
  hasOneAccessor,
  polymorphicBelongsToAccessor,
} from "./association-writers.ts";
import { inferenceHint, type Inference } from "./foreign-keys.ts";
import {
  isModelClass,
  Model,
  modelOf,
  type AttributesOf,
  type ModelClass,
  type ScopesOf,
} from "./model.ts";
import { checkPolymorphic } from "./polymorphic-checks.ts";
import { verifyModel } from "./verify-model.ts";
import { checkThrough } from "./through-associations.ts";
import { throughCollection, throughCollectionMethods } from "./through-writes.ts";
import { state } from "./record-state.ts";
import { collectionMethods, type CollectionMethods } from "./collection-methods.ts";
import { ownedCollection } from "./owned-collection.ts";
import { ofOwner, type Relation, type Scoped } from "./relation.ts";
import { linkOf, resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/**
 * An association's scope, as Rails' `has_many :posts, -> { order(:created_at) }`: it receives
 * the target's Relation, with its scopes, and returns a narrowed one.
 */
type AssociationScope<C extends ModelClass> = (
  relation: Scoped<InstanceType<C>, ScopesOf<C>>,
) => unknown;

/** What an association declaration takes: the keys that link the Models, and a scope. */
export interface AssociationOptions<C extends ModelClass = ModelClass> {
  /**
   * The attribute holding the link: on the owner for belongsTo, on the target otherwise.
   * Inferred when left out, as Rails does: a belongsTo's name + `Id` (`author` → `authorId`),
   * or for a hasMany/hasOne the owner's `modelName` + `Id` (`User` → `userId`).
   */
  foreignKey?: string;
  /** The attribute the foreign key points at; defaults to the pointed-at Model's primary key. */
  primaryKey?: string;
  /** Narrows or orders the target's records for this association: `(q) => q.order(…)`. */
  scope?: AssociationScope<C>;
  /** What destroying the owner does to this association's records (hasMany and hasOne). */
  dependent?: Dependent;
  /**
   * Saving the owner also saves this association's loaded records that changed, and destroys
   * those marked with `markForDestruction()`, as Rails' `autosave: true` does (#37).
   */
  autosave?: true;
}

/**
 * What an association through another takes (#59): `projects = hasMany(Project, { through:
 * "assignments" })`. Its keys and `autosave` are its hops'; a hasMany's `dependent` acts on its
 * join records (`ThroughDependent`).
 */
export interface ThroughOptions<C extends ModelClass = ModelClass> {
  /** The owner's association it reaches its records through: one to the join Model. */
  through: string;
  /**
   * The association of the `through` association's Model that reaches the records. Left out, it's
   * the one named as this association, singular or plural (`projects` → `project`, `projects`).
   */
  source?: string;
  /** Narrows or orders its records: `(q) => q.order(…)`. */
  scope?: AssociationScope<C>;
}

/**
 * What destroying the owner, and removing records with `delete`, do to a hasMany through
 * another's join records (#434): destroy them, callbacks included, or delete their rows.
 */
export type ThroughDependent = "destroy" | "deleteAll";

/** Rails' `dependent:` strategies for a hasMany. */
export type HasManyDependent =
  | "destroy"
  | "deleteAll"
  | "nullify"
  | "restrictWithException"
  | "restrictWithError";

/** Rails' `dependent:` strategies for a hasOne: `delete` in place of `deleteAll`. */
export type HasOneDependent =
  | "destroy"
  | "delete"
  | "nullify"
  | "restrictWithException"
  | "restrictWithError";

type Dependent = HasManyDependent | HasOneDependent;

const DEPENDENTS: Record<AssociationKind, readonly Dependent[]> = {
  belongsTo: [],
  hasMany: ["destroy", "deleteAll", "nullify", "restrictWithException", "restrictWithError"],
  hasOne: ["destroy", "delete", "nullify", "restrictWithException", "restrictWithError"],
};

export type AssociationKind = "belongsTo" | "hasMany" | "hasOne";

/** One declared association: its kind, its target Model, and its options. */
export interface AssociationDeclaration extends AssociationOptions, Partial<ThroughOptions> {
  kind: AssociationKind;
  /** A belongsTo that may point at nothing: its record isn't required (#339). */
  optional?: boolean;
  /** A belongsTo's counter on its target (#61): `true` for the attribute Rails' convention names. */
  counterCache?: true;
  /** The target Model, read when the association is first used (the field holds the class). */
  target: () => ModelClass;
  /**
   * A polymorphic belongsTo's Models (#60): `belongsTo([Post, Photo])`, its record one of them,
   * by the type its owner holds. It has no one `target`.
   */
  targets?: () => readonly ModelClass[];
  /** The attribute holding a polymorphic association's type: the owner's for a belongsTo. */
  foreignType?: string;
  /** A hasMany's or hasOne's target's polymorphic belongsTo, whose other side it is (#60). */
  as?: string;
}

/** One declared association, its foreign key given or inferred from the names (`associationsOf`). */
export interface AssociationDefinition extends AssociationDeclaration {
  foreignKey: string;
  /** A polymorphic association's type attribute, given or inferred (`commentable` → `commentableType`). */
  foreignType?: string;
  /** The association name an inferred type attribute came from, for error messages. */
  typeInferredFrom?: string;
  /** Where an inferred foreign key came from, for error messages. */
  inferredFrom?: Inference;
}

/**
 * `await post.author()`: the owning record, or null. `post.author.set(user)` points the post at
 * another record (Rails' `post.author = user`), and `build`/`create` make a new one for it.
 */
export interface BelongsTo<C extends ModelClass> {
  (): Promise<InstanceType<C> | null>;
  set(record: InstanceType<C> | null): void;
  build(attributes?: Partial<AttributesOf<InstanceType<C>>>): InstanceType<C>;
  create(attributes?: Partial<AttributesOf<InstanceType<C>>>): Promise<InstanceType<C>>;
  createOrThrow(attributes?: Partial<AttributesOf<InstanceType<C>>>): Promise<InstanceType<C>>;
}

/**
 * `await remark.commentable()`: the record a polymorphic belongsTo points at (#60), of whichever
 * listed Model its type names, or null. `remark.commentable.set(post)` points it at another,
 * setting both the type and the key. There's no `build` or `create`: which Model to make isn't
 * known.
 */
export interface PolymorphicBelongsTo<C extends ModelClass> {
  (): Promise<InstanceType<C> | null>;
  set(record: InstanceType<C> | null): void;
}

/**
 * `await user.profile()`: the one associated record, or null. `await user.profile.set(profile)`
 * gives the user another (Rails' `user.profile = profile`), and `build(attrs)` and
 * `create(attrs)` make a new one pointing at the user (Rails' `build_profile`). Each replaces the
 * old record, removed by `dependent:` when the new one is written.
 */
export interface HasOne<C extends ModelClass> {
  (): Promise<InstanceType<C> | null>;
  set(record: InstanceType<C> | null): Promise<void>;
  build(attributes?: Partial<AttributesOf<InstanceType<C>>>): InstanceType<C>;
  create(attributes?: Partial<AttributesOf<InstanceType<C>>>): Promise<InstanceType<C>>;
  createOrThrow(attributes?: Partial<AttributesOf<InstanceType<C>>>): Promise<InstanceType<C>>;
}

/**
 * `user.posts()`: a Relation of the associated records, with the target's scopes, and the
 * collection methods (`push`, `delete`, `destroy`, `clear`) that only the association itself has.
 */
export type HasMany<C extends ModelClass> = () => HasManyCollection<InstanceType<C>, ScopesOf<C>>;

/**
 * `note.tags()` for an association through another (#59): a Relation of its records, which
 * reads and preloads as any hasMany's, with the collection methods. Its writes go to its join
 * records (#434): `push`, `build` and `create` make one, and `delete`, `destroy`, `clear`, and
 * its own `deleteAll` and `destroyAll` remove them. Inserting and upserting, which make none, are typed `never`,
 * so it's still a Relation, for `or`, `merge` and a batch's `updateAll`.
 */
export type HasManyThrough<C extends ModelClass> = () => Scoped<InstanceType<C>, ScopesOf<C>> &
  CollectionMethods<InstanceType<C>> & {
    readonly [W in ThroughWrite]: never;
  };

/** The writes a through association's own Relation refuses (#434): they make no join records. */
type ThroughWrite = "insert" | "insertAll" | "upsert" | "upsertAll";

/**
 * `await mark.note()` for a hasOne through another (#59): its record, or null. `set(note)`
 * points the owner's join record at another (#434); as in Rails, it has no `build` or `create`.
 */
export interface HasOneThrough<C extends ModelClass> {
  (): Promise<InstanceType<C> | null>;
  /**
   * Points the owner's join record at `record`, saved at once on a saved owner, or builds one
   * through the association it goes through; `null` destroys the join record.
   */
  set(record: InstanceType<C> | null): Promise<void>;
  /** Type-only: marks the accessor, so a record method returning a Promise isn't one. */
  readonly [throughTarget]: C;
}

declare const throughTarget: unique symbol;

/** What a hasMany accessor returns: its Relation, with the collection methods. */
export type HasManyCollection<M extends Model, S = {}> = Scoped<M, S> & CollectionMethods<M>;

/** Each prepared Model. */
const prepared = new WeakSet<object>();

/**
 * Makes a Model ready for use, once: verifies its declaration, checks its associations and
 * installs their accessors. Module-level, but not request state (ADR-0003): derived only from
 * the class.
 */
export function readyModel(model: ModelClass): void {
  verifyModel(model);
  if (prepared.has(model)) return;
  for (const [name, definition] of associationsOf(model)) {
    checkAssociation(model, name, definition);
    Object.defineProperty(model.prototype, name, accessorProperty(name, definition));
  }
  prepared.add(model);
}

/** An association's name must be free, its target a Model, and its keys declared attributes. */
function checkAssociation(
  model: ModelClass,
  name: string,
  definition: AssociationDefinition,
): void {
  const label = `${model.name || "A Model class's"} association "${name}"`;
  checkName(label, model, name);
  const targets = checkTargets(label, definition);
  checkPolymorphic(label, model, definition, targets);
  // A through association's keys are its two hops' (#59).
  if (definition.through === undefined) {
    for (const target of targets) checkKeys(label, model, target, definition);
  }
  checkThrough(label, model, name, definition);
  checkDependent(label, definition);
  checkOptional(label, definition);
  checkAutosave(label, definition);
}

/** `autosave` is `true` or left out: `false` isn't built (#378). */
function checkAutosave(label: string, { autosave }: AssociationDefinition): void {
  if (autosave !== undefined && autosave !== true) {
    throw new InvalidModel(`${label}: autosave takes true`);
  }
}

/** Only a belongsTo can be optional: the others never require their records. */
function checkOptional(label: string, { optional, kind }: AssociationDefinition): void {
  if (optional !== undefined && kind !== "belongsTo") {
    throw new InvalidModel(`${label}: only a belongsTo can be optional`);
  }
}

/** Its name can't be an attribute's, or a record method's or property's. */
function checkName(label: string, model: ModelClass, name: string): void {
  if (model.attributeDefinitions.has(name)) {
    throw new InvalidModel(`${label} has the same name as an attribute; rename one of them`);
  }
  if (name in Model.prototype) {
    throw new InvalidModel(`${label} is the name of a record method or property; rename it`);
  }
}

/** Its target must be a Model class: each one a polymorphic belongsTo lists (#60). */
function checkTargets(label: string, definition: AssociationDefinition): ModelClass[] {
  const listed = definition.targets?.() ?? [definition.target()];
  return listed.map((each) => checkTarget(label, each));
}

function checkTarget(label: string, target: unknown): ModelClass {
  if (!isModelClass(target)) {
    throw new InvalidModel(`${label} must point at a Model class: hasMany(Post, …)`);
  }
  return target;
}

/** Its keys must be declared attributes: the foreign key the owner's for a belongsTo, else the target's. */
function checkKeys(
  label: string,
  model: ModelClass,
  target: ModelClass,
  definition: AssociationDefinition,
): void {
  if (definition.inferredFrom?.source === "modelName" && definition.inferredFrom.name === "") {
    throw new InvalidModel(
      `${label} has no class name to infer its foreign key from; pass foreignKey, or set static modelName`,
    );
  }
  const { ownerAttribute, targetAttribute } = linkOf(definition, model, target);
  const [ownerHint, targetHint] =
    definition.kind === "belongsTo"
      ? [keyHint(definition), "check primaryKey"]
      : ["check primaryKey", keyHint(definition)];
  requireAttribute(label, model, ownerAttribute, ownerHint);
  requireAttribute(label, target, targetAttribute, targetHint);
}

/** Its `dependent:` strategy must be one its kind has. */
function checkDependent(label: string, { dependent, kind }: AssociationDefinition): void {
  if (dependent !== undefined && !DEPENDENTS[kind].includes(dependent)) {
    const allowed = DEPENDENTS[kind].map((each) => `"${each}"`).join(", ");
    throw new InvalidModel(
      `${label}: a ${kind} can't be dependent: "${dependent}"${allowed ? `; use one of ${allowed}` : ""}`,
    );
  }
}

/** What to check when the foreign key isn't an attribute: where it was inferred from, if it was. */
function keyHint({ inferredFrom }: AssociationDefinition): string {
  return inferredFrom === undefined ? "check foreignKey" : inferenceHint(inferredFrom);
}

function requireAttribute(label: string, model: ModelClass, name: string, hint: string): void {
  if (model.attributeDefinitions.has(name)) return;
  throw new InvalidModel(`${label}: ${model.name} has no attribute "${name}" (${hint})`);
}

/** Each record's belongsTo and hasOne accessors, made on first use. Not request state. */
const accessors = new WeakMap<Model, Map<string, unknown>>();

/**
 * The property an association adds to its Model's records. A hasMany is a method returning a
 * Relation; a belongsTo or hasOne is a getter for the record's own accessor, a function
 * (`await post.author()`) that also has `set`/`build`/`create` bound to that record.
 */
function accessorProperty(name: string, definition: AssociationDefinition): PropertyDescriptor {
  if (definition.kind === "hasMany") {
    const method = function hasMany(this: Model) {
      return hasManyRelation(this, resolveAssociation(modelOf(this), name));
    };
    return { configurable: true, get: () => method, set: keepAssignedField(name) };
  }
  const accessorFor = accessorKind(definition);
  return {
    configurable: true,
    set: keepAssignedField(name),
    get(this: Model) {
      const perRecord = accessors.get(this) ?? new Map<string, unknown>();
      accessors.set(this, perRecord);
      if (!perRecord.has(name)) {
        perRecord.set(name, accessorFor(this, resolveAssociation(modelOf(this), name)));
      }
      return perRecord.get(name);
    },
  };
}

/** What makes a belongsTo's or hasOne's accessor for a record. */
function accessorKind(definition: AssociationDefinition) {
  if (definition.kind === "hasOne") return hasOneAccessor;
  return definition.targets === undefined ? belongsToAccessor : polymorphicBelongsToAccessor;
}

/**
 * The setter for an association's field when it's assigned rather than defined (a class field
 * compiled without useDefineForClassFields, or below ES2022): it keeps the declaration on the
 * record, as a defined field would be, for `newRecord` to remove.
 */
function keepAssignedField(name: string): (this: Model, value: unknown) => void {
  return function (value) {
    Object.defineProperty(this, name, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  };
}

/**
 * A hasMany's Relation for `owner`: its target's records linked to the owner, answering from
 * what the owner holds (its owned collection) where it can.
 */
function hasManyRelation(owner: Model, association: ResolvedAssociation) {
  const relation = association.linkedTo(owner[state].executor, association.keyOf(owner));
  if (association.hops !== undefined) return throughRelation(owner, association, relation);
  const collection = ownedCollection(owner, association);
  const owned = relation[ofOwner](collection);
  // On this Relation only: one narrowed from it (`where`, a scope, …) is a new Relation without them.
  return Object.assign(
    owned,
    collectionMethods({ owner, association, collection, relation: owned }),
  );
}

/** A through hasMany's Relation for `owner` (#434): what's built or pushed through it gets a join record. */
function throughRelation(
  owner: Model,
  association: ResolvedAssociation,
  relation: Relation<Model>,
) {
  const via = (): Relation<Model> => hasManyRelation(owner, association.hops!.via);
  const collection = throughCollection({ owner, association, via });
  const owned = relation[ofOwner](collection);
  return Object.assign(
    owned,
    throughCollectionMethods({ owner, association, collection, relation: owned, via }),
  );
}

/**
 * A belongsTo or hasOne read: the loaded record (or null) while the key it was loaded for is
 * current, otherwise `load` for the key the owner holds now, kept only if nothing changed the
 * association meanwhile (#189).
 */
export async function cachedRead(
  owner: Model,
  association: ResolvedAssociation,
  load: (key: unknown) => Promise<Model | null>,
): Promise<Model | null> {
  const { name, keyAttributes } = association;
  const cached = owner[state].associations.get(name);
  if (cached !== undefined) return cached.value as Model | null;
  const key = association.keyOf(owner);
  // A polymorphic belongsTo's is kept for its type and key as they are (#60).
  const loadedFor = association.isPolymorphic ? undefined : key;
  const keep = owner[state].associations.startLoad(name, keyAttributes, loadedFor);
  // No key: nothing to find, and nothing to query; that null is loaded like any result.
  const value = key === null ? null : await load(key);
  keep(value);
  return value;
}
