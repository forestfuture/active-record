// `Model.define({...})` and `Model`: the record class, its attribute accessors and its declarations (validations, error messages); its shared statics are in model-statics.ts.
import type { Executor, QueryListener } from "./executor.ts";
import {
  define,
  type AttributeProperties,
  type AttributeDefinition,
  type AttributeSpecs,
  type ExactSpecs,
} from "./metadata.ts";
import { type Permitted, permitted } from "./permit.ts";
import { type AttributeConversions, conversionsFor } from "./attribute-conversions.ts";
import { defaultFilterAttributes, type FilterAttribute } from "./filtering.ts";
import type { Errors } from "./errors-collection.ts";
import { humanAttributeName, type ErrorMessages } from "./error-messages.ts";
import { declare } from "./declarations.ts";
import {
  AssociationNotLoaded,
  RecordInvalid,
  RecordNotDestroyed,
  RecordNotSaved,
} from "./errors.ts";
import { destroyLifecycle, reloadRecord, saveLifecycle, validateRecord } from "./lifecycle.ts";
import { associationOf, newRecord } from "./association-fields.ts";
import { RecordStatement } from "./record-statement.ts";
import { inferTableNames } from "./table-names.ts";
import {
  attributesSettled,
  defineAttributeAccessors,
  defineGeneratedStatics,
  type AsSpecs,
  type AttributeOverrides,
  type DatabaseSchema,
  type OverriddenSpecs,
} from "./generated-model.ts";
import { RecordState, state, type Changes } from "./record-state.ts";
import { inspectCustom, type Inspect, type InspectOptions } from "./inspect-support.ts";
import { inspectRecord } from "./record-inspect.ts";
import { readyModel, type BelongsTo, type HasOne } from "./associations.ts";
import type { Relation, Scope, Scoped } from "./relation.ts";
import { defineStatics, ModelStatics } from "./model-statics.ts";
import { currentRelation } from "./current-database.ts";
import { scopeBodies, scopeName, useModelBase } from "./scoped-relation.ts";
import { checkValidatedNames, type Validation, type ValidationOptions } from "./validations.ts";

/** Type-only brand on a scope static (`static newest = this.scope(…)`); never set at runtime. */
declare const scopeBrand: unique symbol;

/**
 * A scope, as a static on its Model: called on that Model or any class extending it
 * (`Product.newest()`), it returns a Relation of that class, with all its scopes.
 */
export type ScopeStatic<A extends unknown[]> = (<C extends QueryableClass>(
  this: C,
  ...args: A
) => Scoped<InstanceType<C>, ScopesOf<C>>) & { readonly [scopeBrand]: true };

/** A Model class's scopes: its statics made with `this.scope(…)`, its own and inherited. */
export type ScopesOf<C> = {
  // Not `prototype`: that's the record type, whose association fields lead back to other Models.
  [
    K in Exclude<keyof C, "prototype"> as C[K] extends { readonly [scopeBrand]: true } ? K : never
  ]: C[K];
};

/** What `loaded()` returns for an association accessor: its records, or its record or null. */
export type LoadedValue<F> = F extends () => Promise<infer R>
  ? R
  : F extends () => { toArray(): Promise<infer T> }
    ? T
    : never;

/**
 * Any association accessor, whatever its target: by shape, since a Relation of one Model isn't
 * assignable to a Relation of the library's base class.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- any Model's association
type AnyAssociation = BelongsTo<any> | HasOne<any> | (() => Relation<any, any>);

/** The names of a record's association accessors (from their fields' types). */
export type AssociationName<R> = {
  [K in keyof R]: R[K] extends AnyAssociation ? K : never;
}[keyof R] &
  string;

/** A lifecycle callback; it receives the record and may be async. */
export type Callback<R> = (record: R) => unknown;

/** Type-only key carrying a record's declared attribute types; never set at runtime. */
declare const attributeTypes: unique symbol;

/** An attribute's name on record type `R`. */
type AttributeKey<R> = keyof AttributesOf<R> & string;

/** `from`/`to` for the change checks: only matching when the value was, or became, this. */
export interface ChangeOptions<V = unknown> {
  from?: V;
  to?: V;
}

/**
 * What a Model's error messages and attribute names can name: its attributes, its associations
 * and `"base"`; any name on a class without attributes (the app's base class).
 */
export type ErrorAttributeName<R> = [AttributesOf<R>] extends [never]
  ? string
  : AttributeKey<R> | AssociationName<R> | "base";

/** The declared attributes of a record type, excluding methods and getters. */
export type AttributesOf<M> = M extends { readonly [attributeTypes]?: infer A } ? A : never;

/**
 * The library's base class, as Rails' `ActiveRecord::Base`: an app's base class extends it, and
 * methods, statics, callbacks and scopes declared there are shared by every Model built on it.
 * It has no table, so it's never used as a Model itself.
 */
export class Model extends ModelStatics {
  /** The table's name: inferred from the class name (`BlogPost` → `blog_posts`) unless set. */
  declare static table: string;
  /** The primary key attribute: the generated table's, or `"id"` unless set. */
  declare static primaryKey: string;
  declare static attributeDefinitions: ReadonlyMap<string, AttributeDefinition>;
  /**
   * The generated schema, on an app's base class (`static override schema = schema`): the
   * Models built on it have its tables' attributes, and query its binding.
   */
  declare static schema?: DatabaseSchema;
  /**
   * A generated Model's changes to its table's attributes, as in the schema: `static override
   * attributes = { available: "boolean", internalNotes: false } as const`.
   */
  declare static attributes?: AttributeOverrides;
  /**
   * Marks a class between the app's base class and its Models (`static override abstract =
   * true`): it has no table, it shares its behavior, and each class directly below it has one.
   */
  declare static abstract?: boolean;

  /**
   * An app-wide query listener, as `connect(env.DB, { onQuery })` is a database's: called for
   * every statement of this Model (and those extending it), whichever database runs it, after
   * the database's own. Holds no request state, so it's safe on a class; a request's ID comes
   * from a database opened for it with `withDatabase` (#78).
   */
  static onQuery: QueryListener | undefined;

  /**
   * Attributes whose values listeners and errors show as "[FILTERED]", as Rails'
   * `filter_attributes`: an attribute whose snake_case name holds a string entry (in any
   * case), or matches a RegExp. Rails' defaults; replace them on the app's base class (#83).
   */
  static filterAttributes: readonly FilterAttribute[] = defaultFilterAttributes;

  /**
   * Attribute names `toJSON()` leaves out, so `Response.json(record)` can't send them. Exact
   * names; none by default. `attributes()` still has them (#101).
   */
  static hiddenAttributes: readonly string[] = [];

  /** An attribute's name as error messages show it: from `humanAttributeNames`, or "Created at". */
  static humanAttributeName(attribute: string): string {
    return humanAttributeName(this as ModelClass, attribute);
  }

  /** Records on a page of `paginate()` when it isn't given `perPage` (#100). */
  static perPage = 25;

  /**
   * The most records on a page of `paginate()`: a larger `perPage`, given or declared, is
   * capped at it, since D1 bills every row read.
   */
  static maxPerPage = 100;

  /**
   * Makes the value of an attribute declared with `generateId: true` that wasn't given: a
   * UUID by default. Override it on the app's base class to choose the app's ids
   * (`static override generateId = uuidv7`); it gets the attribute's name, never the record (#99).
   */
  static generateId(_attribute: string): string {
    return crypto.randomUUID();
  }

  /**
   * A Model whose attributes are declared here, the single source of truth for them (ADR-0007):
   * `class Visit extends Model.define({ path: "string" }) {}`. It's built on the class it's
   * called on, so a Model made with `ApplicationRecord.define({...})` shares the app's base.
   */
  static define<B extends BaseClass, const A extends AttributeSpecs>(
    this: B,
    specs: A & ExactSpecs<A>,
  ): ModelBaseFor<A, B> {
    return defineModel(specs, this);
  }

  /**
   * Declares a scope, as Rails' `scope :active, -> { … }`: `static active = this.scope((q) =>
   * q.where({ isActive: true }))`. It's a static (`User.active()`) and a Relation method
   * (`User.where(…).active()`), inherited like any static. Inside it, `q` has every Relation
   * method, but not the Model's other scopes (their types would refer to themselves).
   */
  static scope<C extends AbstractModelClass, A extends unknown[]>(
    this: C,
    body: (q: Relation<InstanceType<C>>, ...args: A) => Relation<InstanceType<C>>,
  ): ScopeStatic<A> {
    function scoped(this: QueryableClass, ...args: unknown[]): unknown {
      const relation = this.all() as unknown as Record<string, (...args: unknown[]) => unknown>;
      return relation[scopeName(this, scoped)]!(...args);
    }
    scopeBodies.set(scoped, body as unknown as Scope<Model>);
    return scoped as unknown as ScopeStatic<A>;
  }

  /**
   * All of this Model's records, as Rails' `Product.all`: a Relation on the current database
   * (the request's, set with `withDatabase`, or else the binding in its base class's schema).
   */
  static all<C extends QueryableClass>(this: C): Scoped<InstanceType<C>, ScopesOf<C>> {
    return currentRelation(this);
  }

  /**
   * Only the named attributes of untrusted input (a JSON body, `FormData` or
   * `URLSearchParams`), as Rails' `params.permit`:
   * `User.create(User.permit(await request.json(), "email", "name"))`. Every other key is
   * dropped, and each value is cast as assigning it would be.
   */
  static permit<C extends QueryableClass, K extends AttributeKey<InstanceType<C>>>(
    this: C,
    input: unknown,
    ...names: K[]
  ): Permitted<C, K> {
    return permitted(this, input, names) as Permitted<C, K>;
  }

  /**
   * An attribute's conversions, for SQL d1-record doesn't write, as Rails' `type_for_attribute`:
   * `Post.typeForAttribute("publishedAt").serialize(date)` is what `publishedAt` stores a `Date`
   * as, whatever its `storage`; `cast` and `deserialize` go the other way.
   */
  static typeForAttribute<C extends QueryableClass, K extends AttributeKey<InstanceType<C>>>(
    this: C,
    name: K,
  ): AttributeConversions<AttributesOf<InstanceType<C>>[K]> {
    return conversionsFor(this, name);
  }

  /** Declares a validation, e.g. `this.validates("email", { presence: true })` in `static {}`. */
  static validates<C extends AbstractModelClass>(
    this: C,
    attribute: keyof AttributesOf<InstanceType<C>> & string,
    options: ValidationOptions<InstanceType<C>>,
  ): void {
    const validation: Validation = { attribute, options: options as ValidationOptions<never> };
    // A generated Model's attributes are fixed when it's first used, and checked then.
    if (attributesSettled(this)) checkValidatedNames(this, validation);
    declare(this, "validations", validation);
  }

  /**
   * Error messages in place of the built-in ones, by type (`blank`, or a type of your own), and
   * under `attributes` by attribute and type. A Model's own win over those of the classes it
   * extends, the app's base class's included; a later call's over an earlier one's (#88).
   */
  static errorMessages<C extends AbstractModelClass>(
    this: C,
    messages: ErrorMessages<ErrorAttributeName<InstanceType<C>>>,
  ): void {
    declare(this, "errorMessages", messages as ErrorMessages);
  }

  /**
   * Attribute names as error messages show them, in place of the name made from the attribute
   * ("createdAt" → "Created at"): `{ createdAt: "Signed up" }`. A Model's own win over those of
   * the classes it extends (#88).
   */
  static humanAttributeNames<C extends AbstractModelClass>(
    this: C,
    names: { readonly [K in ErrorAttributeName<InstanceType<C>>]?: string },
  ): void {
    declare(this, "humanAttributeNames", names as Readonly<Record<string, string>>);
  }

  /** @internal This record's values, lifecycle and Snapshot; only `RecordState` changes them. */
  readonly [state] = new RecordState(this.constructor as ModelClass);

  /** The errors from the last validation run. */
  get errors(): Errors {
    return this[state].errors;
  }

  /**
   * A loaded association, synchronously: records for a hasMany, a record or null otherwise.
   * Throws `AssociationNotLoaded` unless it was preloaded with `includes(...)` or already read
   * (and its key hasn't changed since).
   */
  loaded<K extends AssociationName<this>>(name: K): LoadedValue<this[K]> {
    const model = this.constructor as ModelClass;
    associationOf(model, name);
    const cached = this[state].associations.get(name);
    if (cached === undefined) {
      throw new AssociationNotLoaded(
        `${model.name} record hasn't loaded "${name}"; preload it with includes("${name}"), or read it first`,
      );
    }
    // A copy of a list, so changing what's returned never changes the cached data.
    const { value } = cached;
    return (Array.isArray(value) ? [...value] : value) as LoadedValue<this[K]>;
  }

  /** Whether the association is loaded: preloaded or already read, for the key held now. */
  isLoaded<K extends AssociationName<this>>(name: K): boolean {
    associationOf(this.constructor as ModelClass, name);
    return this[state].associations.get(name) !== undefined;
  }

  /**
   * Loads the association again, replacing what's cached, and returns it: Rails'
   * `reload_author`, or `user.posts.reload` for a hasMany.
   */
  async reloadAssociation<K extends AssociationName<this>>(name: K): Promise<LoadedValue<this[K]>> {
    const { kind } = associationOf(this.constructor as ModelClass, name);
    this[state].resetAssociation(name);
    // The accessor installed for this association: a Relation for a hasMany, else a promise.
    const accessor = this[name] as () => Relation<Model> | Promise<Model | null>;
    const read = accessor.call(this);
    const value = kind === "hasMany" ? await (read as Relation<Model>).toArray() : await read;
    return value as LoadedValue<this[K]>;
  }

  /** Why a callback last refused a save or destroy (`abort(reason)`); never copied into `errors`. */
  get abortReason(): string | undefined {
    return this[state].abortReason;
  }

  /** Runs every validation, filling `errors` from scratch; `true` if there are none. */
  async isValid(): Promise<boolean> {
    return validateRecord(this);
  }

  /** Whether any attribute differs from its value as last loaded or saved. */
  isChanged(): boolean {
    return this[state].changedNames().length > 0;
  }

  /** The names of the changed attributes. */
  changed(): string[] {
    return this[state].changedNames();
  }

  /** Each changed attribute's value before the change: `{ email: old }`. */
  changedAttributes(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(this[state].changes()).map(([name, [before]]) => [name, before]),
    );
  }

  /** Each changed attribute's value before and after: `{ email: [old, new] }`. */
  changes(): Changes {
    return this[state].changes();
  }

  /** The changes the last successful save wrote; use it in after-save callbacks. */
  savedChanges(): Changes {
    return this[state].savedChanges();
  }

  /** The attribute's value before its unsaved change, as stored (Rails' `attribute_was`). */
  attributeWas<R extends Model, K extends AttributeKey<R>>(this: R, name: K): AttributesOf<R>[K] {
    return this[state].valueInDatabase(name) as AttributesOf<R>[K];
  }

  /**
   * Whether the attribute has an unsaved change, optionally `from` and/or `to` given values
   * (Rails' `attribute_changed?(name, from:, to:)`).
   */
  isAttributeChanged<R extends Model, K extends AttributeKey<R>>(
    this: R,
    name: K,
    options: ChangeOptions<AttributesOf<R>[K]> = {},
  ): boolean {
    return this[state].isAttributeChanged(name, options);
  }

  /** Whether saving now would write a change to the attribute (for before-callbacks). */
  willSaveChangeTo<R extends Model, K extends AttributeKey<R>>(
    this: R,
    name: K,
    options: ChangeOptions<AttributesOf<R>[K]> = {},
  ): boolean {
    return this[state].isAttributeChanged(name, options);
  }

  /** The last save's change to the attribute, `[before, after]`, if it changed (for after-callbacks). */
  savedChangeTo<R extends Model, K extends AttributeKey<R>>(
    this: R,
    name: K,
  ): [before: AttributesOf<R>[K], after: AttributesOf<R>[K]] | undefined {
    this[state].read(name);
    const change = this[state].savedChanges()[name];
    return change === undefined
      ? undefined
      : ([...change] as [AttributesOf<R>[K], AttributesOf<R>[K]]);
  }

  /** Whether the last save changed the attribute, optionally `from` and/or `to` given values. */
  hasSavedChangeTo<R extends Model, K extends AttributeKey<R>>(
    this: R,
    name: K,
    options: ChangeOptions<AttributesOf<R>[K]> = {},
  ): boolean {
    return this[state].hasSavedChangeTo(name, options);
  }

  /** The attribute's value before the last save (its current stored value, if that didn't change it). */
  attributeBeforeLastSave<R extends Model, K extends AttributeKey<R>>(
    this: R,
    name: K,
  ): AttributesOf<R>[K] {
    this[state].read(name);
    const change = this[state].savedChanges()[name];
    return (
      change === undefined ? this[state].valueInDatabase(name) : change[0]
    ) as AttributesOf<R>[K];
  }

  /** Undoes unsaved changes to these attributes (all of them by default), as Rails' `restore_attributes`. */
  restoreAttributes<R extends Model>(this: R, names?: readonly AttributeKey<R>[]): void {
    this[state].restore(names);
  }

  /** Inserts a new record or updates a persisted one; `false` if it's invalid or a callback aborted. */
  async save(): Promise<boolean> {
    return (await saveLifecycle(this)).status === "saved";
  }

  /** Like `save()`, but throws `RecordInvalid` or `RecordNotSaved` instead of returning `false`. */
  async saveOrThrow(): Promise<true> {
    const outcome = await saveLifecycle(this);
    if (outcome.status === "invalid") throw new RecordInvalid(this);
    if (outcome.status === "aborted") throw new RecordNotSaved(outcome.reason);
    return true;
  }

  /** Assigns several attributes without saving. */
  assign(attributes: Partial<AttributesOf<this>>): this {
    this[state].assign(attributes);
    return this;
  }

  /** `assign` then `save`. */
  async update(attributes: Partial<AttributesOf<this>>): Promise<boolean> {
    this[state].requireLive("be updated");
    return this.assign(attributes).save();
  }

  /** `assign` then `saveOrThrow`. */
  async updateOrThrow(attributes: Partial<AttributesOf<this>>): Promise<true> {
    this[state].requireLive("be updated");
    return this.assign(attributes).saveOrThrow();
  }

  /**
   * Deletes the row and resolves to this record, now a read-only destroyed snapshot.
   * A row that's already gone still counts. `false` means a `beforeDestroy` callback aborted.
   */
  async destroy(): Promise<this | false> {
    return (await destroyLifecycle(this)).status === "destroyed" ? this : false;
  }

  /**
   * This record's save, for `db.batch([...])`: its validations and callbacks run when the batch
   * runs, and every record in the batch is written atomically.
   */
  toSave(): RecordStatement<this> {
    return new RecordStatement(this, "save");
  }

  /** This record's destroy, dependents included, for `db.batch([...])`. */
  toDestroy(): RecordStatement<this> {
    return new RecordStatement(this, "destroy");
  }

  /** Like `destroy()`, but throws `RecordNotDestroyed` instead of returning `false`. */
  async destroyOrThrow(): Promise<this> {
    const outcome = await destroyLifecycle(this);
    if (outcome.status !== "destroyed") throw new RecordNotDestroyed(outcome.reason);
    return this;
  }

  /** Loads the stored row again, discarding unsaved changes; `RecordNotFound` if it's gone. */
  async reload(): Promise<this> {
    await reloadRecord(this);
    return this;
  }

  /** Not yet saved: built, or created but not persisted. */
  isNewRecord(): boolean {
    return this[state].isNew;
  }

  /** Backed by a row: loaded, or saved successfully. */
  isPersisted(): boolean {
    return this[state].isPersisted;
  }

  /** Deleted by this instance; a read-only snapshot of the row. */
  isDestroyed(): boolean {
    return this[state].isDestroyed;
  }

  /** The record's attributes as a plain object of JavaScript values. */
  attributes(): Record<string, unknown> {
    return this[state].attributes();
  }

  /** Prints as `Name { attribute: value, … }` in a console, a log or a test failure (#104). */
  [inspectCustom](depth: number, options: InspectOptions, inspect: Inspect): string {
    return inspectRecord(modelOf(this), this[state], { depth, options, inspect });
  }

  /**
   * The loaded attributes as JSON-ready values (dates as ISO strings), without the Model's
   * `hiddenAttributes`, for `Response.json(record)`.
   */
  toJSON(): Record<string, unknown> {
    const { hiddenAttributes } = modelOf(this);
    return Object.fromEntries(
      Object.entries(this[state].attributes())
        .filter(([name]) => !hiddenAttributes.includes(name))
        .map(([name, value]) => [name, value instanceof Date ? value.toISOString() : value]),
    );
  }
}

/** Constructor type for any Model class, used wherever the library accepts one. */
export type ModelClass<M extends Model = Model> = (new () => M) & Omit<typeof Model, "prototype">;

/**
 * A Model class whose records have attributes, generated or declared with `define`: what the
 * statics that query are called on, so an ungenerated Model's, or an abstract class's, are a
 * compile error.
 */
export type QueryableClass<M extends Model = Model> = ModelClass<
  M & { readonly [attributeTypes]: unknown }
>;

defineStatics(Model);
defineGeneratedStatics(Model);

// Model and its statics are all defined now: scopes stop at it, and can't take its names;
// and relationFor makes each Model ready with readyModel (hoisted, so it exists already).
useModelBase(Model, readyModel);

/**
 * What a generated declaration adds to a Model's records: its table's attributes `A`, with the
 * Model's `static attributes` overrides `O` applied, typed.
 */
export type TableAttributes<A extends AttributeSpecs, O = {}> = AttributeProperties<
  AsSpecs<OverriddenSpecs<A, O>>
> & {
  readonly [attributeTypes]: AttributeProperties<AsSpecs<OverriddenSpecs<A, O>>>;
};

/**
 * A Model class or a class Models are built on, abstract ones included (the app's base class):
 * what the statics that declare behavior (callbacks, validations, scopes) are called on.
 */
export type AbstractModelClass<M extends Model = Model> = (abstract new () => M) &
  Omit<typeof Model, "prototype">;

/** A class to build Models on: `Model`, or an app's class extending it (`ApplicationRecord`'s). */
export type BaseClass = abstract new () => Model;

/**
 * The base class `Model.define({...})` makes: records with the attributes `A`, built on `B` (the
 * library's base, or an app's), so they have its methods and statics too.
 */
export type ModelBaseFor<
  A extends AttributeSpecs,
  B extends BaseClass = typeof Model,
> = (new () => InstanceType<B> &
  AttributeProperties<A> & { readonly [attributeTypes]: AttributeProperties<A> }) &
  Omit<B, "prototype">;

/** `Model.define({...})` on `base`: a class with the attributes' accessors, extending `base`. */
function defineModel<const A extends AttributeSpecs, B extends BaseClass>(
  specs: A,
  base: B,
): ModelBaseFor<A, B> {
  const Parent = base as unknown as typeof Model;
  class DefinedModel extends Parent {
    static override attributeDefinitions: ReadonlyMap<string, AttributeDefinition> = new Map(
      Object.entries(specs).map(([name, spec]) => [name, define(name, spec)]),
    );
  }
  inferTableNames(DefinedModel);
  defineAttributeAccessors(DefinedModel.prototype, Object.keys(specs));
  return DefinedModel as never;
}

/** A record's Model: its class. */
export function modelOf(record: Model): ModelClass {
  return record.constructor as ModelClass;
}

/** The record's primary key value. */
export function primaryKeyOf(record: Model): unknown {
  return record[state].read(modelOf(record).primaryKey);
}

/** Builds a persisted record of `model` from a D1 row. */
export function hydrate<M extends Model>(
  model: ModelClass<M>,
  row: Record<string, unknown>,
  executor: Executor,
): M {
  const record = newRecord(model);
  record[state].belongTo(executor);
  record[state].loadRow(row);
  return record;
}

/**
 * A new, unsaved record. Every attribute reads as null until assigned; defaults are
 * evaluated now and count as assigned, and so are the given attributes.
 */
export function buildRecord<M extends Model>(
  model: ModelClass<M>,
  attributes: Record<string, unknown>,
  executor: Executor,
): M {
  const record = newRecord(model);
  record[state].belongTo(executor);
  record[state].build(attributes);
  return record;
}
