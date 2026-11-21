// The statics every Model gets from Model: its Relation methods (`Product.where(…)`), `destroy`, `delete` and the counters (`updateCounters`, `incrementCounter`, `decrementCounter`, `resetCounters`) by primary key, and callbacks (`this.beforeSave(…)`), typed and defined from their lists.
import {
  declare,
  type AroundCallback,
  type AroundCallbackKind,
  type CallbackKind,
  type CommitAction,
  type CommitCallbackKind,
} from "./declarations.ts";
import type {
  AbstractModelClass,
  AttributesOf,
  CollectionName,
  Callback,
  Model,
  ModelClass,
  QueryableClass,
  ScopesOf,
} from "./model.ts";
import type { PaginateStatic } from "./pagination.ts";
import { destroyTogether } from "./records-together.ts";
import { resetCounters } from "./owners-counter.ts";
import type { GroupedRelation, GroupTerms } from "./grouping.ts";
import {
  inContext,
  VALIDATION_CALLBACK_KINDS,
  type ContextOf,
  type ValidationCallbackOptions,
} from "./validation-context.ts";
import type {
  AttributeList,
  CalculatedValue,
  NumberAttribute,
  OrderedAttribute,
} from "./calculations.ts";
import type { SafeSql } from "./sql.ts";
import { amount, type CounterOptions, type Counters } from "./counters.ts";
import type { NumberAttributeKey } from "./attribute-writes.ts";
import type { InOrderOfOptions } from "./list-order.ts";
import type { Relation, Scoped } from "./relation.ts";

/** A Model's Relation, as its statics return them: `Product.where(…)` is `Product.all().where(…)`. */
type RelationOf<C extends ModelClass> = Scoped<InstanceType<C>, ScopesOf<C>>;

/** The Relation methods every Model has as statics (besides the overloaded ones). */
const relationMethods = [
  "where",
  "whereNot",
  "rewhere",
  "unscope",
  "only",
  "excluding",
  "none",
  "or",
  "order",
  "reorder",
  "limit",
  "offset",
  "select",
  "distinct",
  "includes",
  "joins",
  "leftJoins",
  "createWith",
  "build",
  "insert",
  "insertAll",
  "upsert",
  "upsertAll",
  "updateAll",
  "touchAll",
  "deleteAll",
  "destroyAll",
  "destroyBy",
  "deleteBy",
  "create",
  "createOrThrow",
  "findBy",
  "findByOrThrow",
  "findSoleBy",
  "findOrCreateBy",
  "findOrCreateByOrThrow",
  "findOrInitializeBy",
  "createOrFindBy",
  "createOrFindByOrThrow",
  "first",
  "last",
  "take",
  "firstOrThrow",
  "lastOrThrow",
  "takeOrThrow",
  "sole",
  "count",
  "average",
  "size",
  "isEmpty",
  "hasAny",
  "hasMoreThanOne",
  "hasExactlyOne",
  "exists",
  "ids",
  "toArray",
  "toSql",
  "findEach",
  "findInBatches",
  "inBatches",
] as const;

/** A Relation method with no overloads, by name. */
type RelationMethod = (typeof relationMethods)[number];

/**
 * A Relation method as a static of every Model, typed for the class it's called on: `Product.where`
 * returns a Relation of `Product`, and on a subclass, of the subclass.
 */
type RelationStatic<K extends RelationMethod> = <C extends QueryableClass>(
  this: C,
  ...args: RelationOf<C>[K] extends (...args: infer A) => unknown ? A : never
) => RelationOf<C>[K] extends (...args: never) => infer R ? R : never;

/** Every Relation method in the list as a static, mapped over Relation's so each keeps its doc comment. */
type RelationStatics = {
  [K in keyof Pick<Relation<Model>, RelationMethod>]: RelationStatic<K>;
};

/** A calculation's static, of a class's attribute `K`, or an `sql` fragment: `Order.sum("total")`. */
type CalculationStatic<AttributeKind extends "number" | "ordered", Fragment, Null> = <
  C extends QueryableClass,
  K extends
    | (AttributeKind extends "number"
        ? NumberAttribute<InstanceType<C>>
        : OrderedAttribute<InstanceType<C>>)
    | SafeSql,
>(
  this: C,
  attribute: K,
) => Promise<CalculatedValue<InstanceType<C>, K, Fragment> | Null>;

/** The Relation methods with overloads or type parameters, typed by hand. */
interface OverloadedStatics {
  /**
   * The class's Relation with `other`'s conditions ANDed on, and its explicit clauses replacing
   * its own; `other` may be a Relation of a Model the Relation joins once (#24).
   */
  merge: <C extends QueryableClass, T extends Model, O>(
    this: C,
    other: Relation<T, O>,
  ) => RelationOf<C>;
  sum: CalculationStatic<"number", number, never>;
  minimum: CalculationStatic<"ordered", unknown, null>;
  maximum: CalculationStatic<"ordered", unknown, null>;
  calculate: {
    <C extends QueryableClass>(
      this: C,
      operation: "count",
      attribute?: keyof AttributesOf<InstanceType<C>> & string,
    ): Promise<number>;
    <C extends QueryableClass, K extends NumberAttribute<InstanceType<C>> | SafeSql>(
      this: C,
      operation: "sum",
      attribute: K,
    ): Promise<CalculatedValue<InstanceType<C>, K>>;
    <C extends QueryableClass>(
      this: C,
      operation: "average",
      attribute: NumberAttribute<InstanceType<C>> | SafeSql,
    ): Promise<number | null>;
    <C extends QueryableClass, K extends OrderedAttribute<InstanceType<C>> | SafeSql>(
      this: C,
      operation: "minimum" | "maximum",
      attribute: K,
    ): Promise<CalculatedValue<InstanceType<C>, K, unknown> | null>;
  };
  paginate: PaginateStatic;
  /** The class's Relation ordered by `attribute`'s place in `values` (#350). */
  inOrderOf: <C extends QueryableClass, K extends keyof AttributesOf<InstanceType<C>> & string>(
    this: C,
    attribute: K,
    values: readonly AttributesOf<InstanceType<C>>[K][],
    options?: InOrderOfOptions,
  ) => RelationOf<C>;
  group: <C extends QueryableClass, const G extends GroupTerms<InstanceType<C>>>(
    this: C,
    ...terms: G
  ) => GroupedRelation<InstanceType<C>, G>;
  find: {
    <C extends QueryableClass>(this: C, id: string | number): Promise<InstanceType<C>>;
    <C extends QueryableClass>(
      this: C,
      ids: readonly (string | number)[],
    ): Promise<InstanceType<C>[]>;
    <C extends QueryableClass>(
      this: C,
      first: string | number,
      second: string | number,
      ...rest: (string | number)[]
    ): Promise<InstanceType<C>[]>;
  };
  pluck: {
    <C extends QueryableClass, K extends keyof AttributesOf<InstanceType<C>> & string>(
      this: C,
      attribute: K,
    ): Promise<AttributesOf<InstanceType<C>>[K][]>;
    <C extends QueryableClass, const K extends AttributeList<InstanceType<C>>>(
      this: C,
      ...attributes: K
    ): Promise<{ -readonly [I in keyof K]: AttributesOf<InstanceType<C>>[K[I]] }[]>;
  };
  pick: {
    <C extends QueryableClass, K extends keyof AttributesOf<InstanceType<C>> & string>(
      this: C,
      attribute: K,
    ): Promise<AttributesOf<InstanceType<C>>[K] | null>;
    <C extends QueryableClass, const K extends AttributeList<InstanceType<C>>>(
      this: C,
      ...attributes: K
    ): Promise<{ -readonly [I in keyof K]: AttributesOf<InstanceType<C>>[K[I]] } | null>;
  };
}

/** A primary key, or several, as `find` takes them. */
type Keys = string | number | readonly (string | number)[];

/** Writes by primary key, statics only: a hasMany's `destroy` and `delete` take records instead. */
interface KeyedWriteStatics {
  /**
   * Finds the records with these primary keys, as `find` does (`RecordNotFound` if one is
   * missing, before anything is destroyed), and destroys them together, callbacks and dependents
   * included: if one refuses, it throws `RecordNotDestroyed` and nothing is destroyed. Resolves
   * to the record, or the records in the order given.
   */
  destroy: {
    <C extends QueryableClass>(this: C, id: string | number): Promise<InstanceType<C>>;
    <C extends QueryableClass>(
      this: C,
      ids: readonly (string | number)[],
    ): Promise<InstanceType<C>[]>;
  };
  /**
   * Deletes the rows with these primary keys, as `deleteBy` does: no callbacks, and no error for
   * a key with no row. Resolves to the number of rows deleted.
   */
  delete: <C extends QueryableClass>(this: C, ids: Keys) => Promise<number>;
  /**
   * Adds to number attributes in the rows with these primary keys, as a Relation's
   * `updateCounters` does, whatever the default scope: `Post.updateCounters(id, { viewCount: 1 })`.
   * Resolves to the number of rows.
   */
  updateCounters: <C extends QueryableClass>(
    this: C,
    ids: Keys,
    counters: Counters<InstanceType<C>>,
    options?: CounterOptions<InstanceType<C>>,
  ) => Promise<number>;
  /** `updateCounters` for one attribute, adding `by` (one by default): `{ by: 5, touch }`. */
  incrementCounter: CounterStatic;
  /** `updateCounters` for one attribute, taking `by` (one by default) away: `{ by: 5, touch }`. */
  decrementCounter: CounterStatic;
  /**
   * Sets the counter caches of the record with this primary key (#61) to how many records each
   * named hasMany has, counted in the same write: `Topic.resetCounters(id, "replies")`, or a
   * list of names, and `{ touch }`. A missing record is `RecordNotFound`, as `find`'s.
   */
  resetCounters: <C extends QueryableClass>(
    this: C,
    id: string | number,
    names: CollectionName<InstanceType<C>> | readonly CollectionName<InstanceType<C>>[],
    options?: CounterOptions<InstanceType<C>>,
  ) => Promise<void>;
}

/** `Post.incrementCounter("viewCount", id, { by })`, typed for the class it's called on. */
type CounterStatic = <C extends QueryableClass>(
  this: C,
  name: NumberAttributeKey<InstanceType<C>>,
  ids: Keys,
  options?: { by?: number } & CounterOptions<InstanceType<C>>,
) => Promise<number>;

/** A callback static, typed for the class it's declared on: `this.beforeSave((record) => …)`. */
type CallbackStatic = <C extends AbstractModelClass>(
  this: C,
  callback: Callback<InstanceType<C>>,
) => void;

/**
 * A validation callback static, which can run only in some validation contexts (#51):
 * `this.beforeValidation((record) => …, { on: "create" })`.
 */
type ValidationCallbackStatic = <C extends AbstractModelClass>(
  this: C,
  callback: Callback<InstanceType<C>>,
  options?: ValidationCallbackOptions<ContextOf<C>>,
) => void;

/**
 * Declares a callback that runs synchronously as a record is loaded or built: nothing awaits it,
 * so its type refuses one that returns a promise (an `async` one), as running it does.
 */
type SyncCallbackStatic = <C extends AbstractModelClass>(
  this: C,
  callback: (
    record: InstanceType<C>,
  ) => string | number | bigint | boolean | symbol | null | undefined,
) => void;

/** Every callback kind as a static, each documented here, so its doc comment shows on hover. */
interface CallbackStatics {
  /**
   * Runs before the validators, e.g. to normalize input. May `throw abort(reason)`. With `on`,
   * only in that validation context, or those.
   */
  beforeValidation: ValidationCallbackStatic;
  /**
   * Runs after the validators, whether or not they passed. May `throw abort(reason)`. With
   * `on`, only in that validation context, or those.
   */
  afterValidation: ValidationCallbackStatic;
  /** Runs before every save (create or update), after validation. May `throw abort(reason)`. */
  beforeSave: CallbackStatic;
  /** Runs before inserting a new record, after `beforeSave`. May `throw abort(reason)`. */
  beforeCreate: CallbackStatic;
  /** Runs before updating a persisted record, after `beforeSave`. May `throw abort(reason)`. */
  beforeUpdate: CallbackStatic;
  /** Runs after a new record was inserted, before `afterSave`. */
  afterCreate: CallbackStatic;
  /** Runs after a persisted record was saved (even with nothing to write), before `afterSave`. */
  afterUpdate: CallbackStatic;
  /** Runs after every successful save; the record is already persisted and clean. */
  afterSave: CallbackStatic;
  /** Runs before deleting the row. May `throw abort(reason)` to refuse the destroy. */
  beforeDestroy: CallbackStatic;
  /** Runs after the row was deleted; the record is already destroyed. */
  afterDestroy: CallbackStatic;
  /** Runs after `touch()` wrote the record's timestamps (#50); no save callback runs for it. */
  afterTouch: CallbackStatic;
  /**
   * Runs when the database refused the record's save or destroy (a constraint, or another write in
   * its batch). Not for a validation failure or an `abort()`: nothing was sent then.
   */
  afterRollback: CallbackStatic;
  /**
   * Runs as a record is loaded from a row (#49): by a query, an association read, a preload or
   * `reload`, before `afterInitialize`. Synchronous: one that returns a promise throws `TypeError`.
   */
  afterFind: SyncCallbackStatic;
  /**
   * Runs as a record is built (after `build`'s `init`) or loaded (after `afterFind`) (#49).
   * Synchronous: one that returns a promise throws `TypeError`.
   */
  afterInitialize: SyncCallbackStatic;
}

/** An around callback static (#48): `this.aroundSave(async (record, next) => { …; await next(); … })`. */
type AroundCallbackStatic = <C extends AbstractModelClass>(
  this: C,
  callback: AroundCallback<InstanceType<C>>,
) => void;

/** The around callbacks as statics: each wraps the rest of a save or destroy (#48). */
interface AroundStatics {
  /**
   * Wraps a save, after `beforeSave`: `await next()` runs `beforeCreate` or `beforeUpdate`, the
   * write, and `afterCreate` or `afterUpdate`; `afterSave` runs once it's finished. One that
   * doesn't call `next()` stops the save, as `abort()` does.
   */
  aroundSave: AroundCallbackStatic;
  /** Wraps a create, after `beforeCreate`: `await next()` runs the INSERT; then `afterCreate`. */
  aroundCreate: AroundCallbackStatic;
  /** Wraps an update, after `beforeUpdate`: `await next()` runs the UPDATE; then `afterUpdate`. */
  aroundUpdate: AroundCallbackStatic;
  /** Wraps a destroy, after `beforeDestroy`: `await next()` runs the DELETE; then `afterDestroy`. */
  aroundDestroy: AroundCallbackStatic;
}

/** The around callback kinds, one static each; `satisfies` keeps the list and the type agreed. */
const aroundKinds = Object.keys({
  aroundSave: true,
  aroundCreate: true,
  aroundUpdate: true,
  aroundDestroy: true,
} satisfies Record<AroundCallbackKind, true> satisfies Record<
  keyof AroundStatics,
  true
>) as AroundCallbackKind[];

/** The commit callbacks as statics: each runs after every after-callback of its write. */
interface CommitStatics {
  /** Runs once a create, update or destroy is kept, after every after-callback. */
  afterCommit: CallbackStatic;
  /** Runs once a create is kept, after every after-callback. */
  afterCreateCommit: CallbackStatic;
  /** Runs once an update is kept, after every after-callback. */
  afterUpdateCommit: CallbackStatic;
  /** Runs once a create or update is kept, after every after-callback. */
  afterSaveCommit: CallbackStatic;
  /** Runs once a destroy is kept, after every after-callback. */
  afterDestroyCommit: CallbackStatic;
}

/**
 * The writes each commit callback runs for. Both `satisfies` make the list, `CommitCallbackKind` and
 * `CommitStatics` name the same kinds.
 */
const commitKinds = {
  afterCommit: ["create", "update", "destroy"],
  afterCreateCommit: ["create"],
  afterUpdateCommit: ["update"],
  afterSaveCommit: ["create", "update"],
  afterDestroyCommit: ["destroy"],
} satisfies Record<CommitCallbackKind, readonly CommitAction[]> satisfies Record<
  keyof CommitStatics,
  readonly CommitAction[]
>;

/**
 * The callback kinds, one static each. Both `satisfies` make the list, `CallbackKind` and
 * `CallbackStatics` name the same kinds: none missing from any, and none extra.
 */
const callbackKinds = Object.keys({
  beforeValidation: true,
  afterValidation: true,
  beforeSave: true,
  beforeCreate: true,
  beforeUpdate: true,
  afterCreate: true,
  afterUpdate: true,
  afterSave: true,
  beforeDestroy: true,
  afterDestroy: true,
  afterTouch: true,
  afterRollback: true,
  afterFind: true,
  afterInitialize: true,
} satisfies Record<CallbackKind, true> satisfies Record<
  keyof CallbackStatics,
  true
>) as CallbackKind[];

/**
 * The class Model extends, for its statics' types only: at runtime it's empty, and
 * `defineStatics` puts the statics on Model itself, where scopes look for the names they
 * can't take.
 */
export const ModelStatics = class {} as unknown as (abstract new () => object) &
  RelationStatics &
  OverloadedStatics &
  KeyedWriteStatics &
  CallbackStatics &
  AroundStatics &
  CommitStatics;

/**
 * Defines the statics on `base`: every Relation method, called on `all()`, and
 * a static for each callback kind, which declares a callback of that kind.
 */
export function defineStatics(base: typeof Model): void {
  for (const kind of callbackKinds) {
    defineStatic(
      base,
      kind,
      function (this: object, callback: Callback<Model>, options?: ValidationCallbackOptions) {
        const on = isValidationKind(kind) ? options?.on : undefined;
        declare(this, kind, on === undefined ? callback : inContext(callback, on));
      },
    );
  }
  for (const kind of aroundKinds) {
    defineStatic(base, kind, function (this: object, callback: AroundCallback<Model>): void {
      declare(this, kind, callback);
    });
  }
  for (const [kind, on] of Object.entries(commitKinds) as [CommitCallbackKind, CommitAction[]][]) {
    defineStatic(base, kind, function (this: object, callback: Callback<Model>): void {
      declare(this, "commitCallbacks", { kind, on, callback });
    });
  }
  const overloaded = [
    "merge",
    "find",
    "pluck",
    "pick",
    "paginate",
    "group",
    "inOrderOf",
    "sum",
    "minimum",
    "maximum",
    "calculate",
  ];
  for (const name of [...relationMethods, ...overloaded]) {
    defineStatic(base, name, function (this: QueryableClass, ...args: unknown[]): unknown {
      const relation = this.all() as unknown as Record<string, (...args: unknown[]) => unknown>;
      return relation[name]!(...args);
    });
  }
  defineKeyedWrites(base);
}

/** `Model.destroy(ids)`, `Model.delete(ids)`, and the counter statics, on the current database. */
function defineKeyedWrites(base: typeof Model): void {
  defineStatic(base, "destroy", async function (this: QueryableClass, ids: Keys) {
    const found: Model | Model[] = await this.all().find(ids as never);
    await destroyTogether(Array.isArray(found) ? found : [found], "destroy() needs its records");
    return found;
  });
  defineStatic(base, "delete", async function (this: QueryableClass, ids: Keys) {
    // oxlint-disable-next-line active-record/stored-key-lookup -- the caller's ids, normalized as find's are
    return this.all().deleteBy({ [this.primaryKey]: ids } as never);
  });
  defineStatic(
    base,
    "updateCounters",
    async function (
      this: QueryableClass,
      ids: Keys,
      counters: Counters<Model>,
      options?: CounterOptions<Model>,
    ) {
      return (
        this.unscoped()
          // oxlint-disable-next-line active-record/stored-key-lookup -- the caller's ids, normalized as find's are
          .where({ [this.primaryKey]: ids } as never)
          .updateCounters(counters, options)
      );
    },
  );
  defineStatic(
    base,
    "resetCounters",
    async function (
      this: QueryableClass,
      id: string | number,
      names: string | readonly string[],
      { touch }: CounterOptions<Model> = {},
    ) {
      return resetCounters(this, id, names, touch);
    },
  );
  for (const [name, sign] of [
    ["incrementCounter", 1],
    ["decrementCounter", -1],
  ] as const) {
    defineStatic(
      base,
      name,
      async function (
        this: QueryableClass,
        attribute: string,
        ids: Keys,
        options: { by?: unknown } & CounterOptions<Model> = {},
      ) {
        const { by = 1, touch } = options;
        const counters = { [attribute]: sign * amount(by, name) } as never;
        return this.updateCounters(ids, counters, { touch });
      },
    );
  }
}

/** Whether a callback kind takes `on`, to run only in some validation contexts (#51). */
function isValidationKind(kind: CallbackKind): boolean {
  return (VALIDATION_CALLBACK_KINDS as readonly CallbackKind[]).includes(kind);
}

/** `method` as the static `name` of `base`, named and described as a class's own static is. */
function defineStatic(base: object, name: string, method: (...args: never) => unknown): void {
  Object.defineProperty(method, "name", { value: name });
  Object.defineProperty(base, name, { value: method, writable: true, configurable: true });
}
