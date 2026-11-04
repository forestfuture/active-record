// Association types and options, and readying a Model: its associations checked and installed.
import { InvalidModel } from "./errors.ts";
import { associationsOf } from "./association-fields.ts";
import { belongsToAccessor, hasOneAccessor } from "./association-writers.ts";
import { inferenceHint, type Inference } from "./foreign-keys.ts";
import { Model, modelOf, type AttributesOf, type ModelClass, type ScopesOf } from "./model.ts";
import { verifyModel } from "./verify-model.ts";
import { state } from "./record-state.ts";
import { ownedCollection } from "./owned-collection.ts";
import { ofOwner, type Scoped } from "./relation.ts";
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
   * or for a hasMany/hasOne the owner's class name + `Id` (`User` → `userId`).
   */
  foreignKey?: string;
  /** The attribute the foreign key points at; defaults to the pointed-at Model's primary key. */
  primaryKey?: string;
  /** Narrows or orders the target's records for this association: `(q) => q.order(…)`. */
  scope?: AssociationScope<C>;
  /** What destroying the owner does to this association's records (hasMany and hasOne). */
  dependent?: Dependent;
}

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
export interface AssociationDeclaration extends AssociationOptions {
  kind: AssociationKind;
  /** The target Model, read when the association is first used (the field holds the class). */
  target: () => ModelClass;
}

/** One declared association, its foreign key given or inferred from the names (`associationsOf`). */
export interface AssociationDefinition extends AssociationDeclaration {
  foreignKey: string;
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
 * `await user.profile()`: the one associated record, or null. `user.profile.build(attrs)` and
 * `create(attrs)` make a new one pointing at the user (Rails' `build_profile`).
 */
export interface HasOne<C extends ModelClass> {
  (): Promise<InstanceType<C> | null>;
  build(attributes?: Partial<AttributesOf<InstanceType<C>>>): InstanceType<C>;
  create(attributes?: Partial<AttributesOf<InstanceType<C>>>): Promise<InstanceType<C>>;
  createOrThrow(attributes?: Partial<AttributesOf<InstanceType<C>>>): Promise<InstanceType<C>>;
}

/** `user.posts()`: a Relation of the associated records, with the target's scopes. */
export type HasMany<C extends ModelClass> = () => Scoped<InstanceType<C>, ScopesOf<C>>;

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
  const target = checkTarget(label, definition);
  checkKeys(label, model, target, definition);
  checkDependent(label, definition);
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

/** Its target must be a Model class. */
function checkTarget(label: string, definition: AssociationDefinition): ModelClass {
  const target: unknown = definition.target();
  if (typeof target !== "function" || !(target.prototype instanceof Model)) {
    throw new InvalidModel(`${label} must point at a Model class: hasMany(Post, …)`);
  }
  return target as ModelClass;
}

/** Its keys must be declared attributes: the foreign key the owner's for a belongsTo, else the target's. */
function checkKeys(
  label: string,
  model: ModelClass,
  target: ModelClass,
  definition: AssociationDefinition,
): void {
  if (definition.inferredFrom?.source === "className" && definition.inferredFrom.name === "") {
    throw new InvalidModel(
      `${label} has no class name to infer its foreign key from; pass foreignKey`,
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
  const accessorFor = definition.kind === "belongsTo" ? belongsToAccessor : hasOneAccessor;
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
  return relation[ofOwner](ownedCollection(owner, association));
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
  const { name, ownerAttribute } = association;
  const cached = owner[state].associations.get(name);
  if (cached !== undefined) return cached.value as Model | null;
  const key = association.keyOf(owner);
  const keep = owner[state].associations.startLoad(name, ownerAttribute, key);
  // No key: nothing to find, and nothing to query; that null is loaded like any result.
  const value = key === null ? null : await load(key);
  keep(value);
  return value;
}
