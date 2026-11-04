// The statics every Model gets from Model: its Relation methods (`Product.where(…)`) and callbacks (`this.beforeSave(…)`), typed and defined from their lists.
import { declare, type CallbackKind } from "./declarations.ts";
import type {
  AbstractModelClass,
  AttributesOf,
  Callback,
  Model,
  ModelClass,
  QueryableClass,
  ScopesOf,
} from "./model.ts";
import type { PaginateStatic } from "./pagination.ts";
import type { Relation, Scoped } from "./relation.ts";

/** A Model's Relation, as its statics return them: `Product.where(…)` is `Product.all().where(…)`. */
type RelationOf<C extends ModelClass> = Scoped<InstanceType<C>, ScopesOf<C>>;

/** The Relation methods every Model has as statics (besides the overloaded ones). */
const relationMethods = [
  "where",
  "whereNot",
  "none",
  "or",
  "merge",
  "order",
  "reorder",
  "limit",
  "offset",
  "select",
  "distinct",
  "includes",
  "build",
  "insert",
  "toInsert",
  "insertAll",
  "toInsertAll",
  "upsert",
  "toUpsert",
  "upsertAll",
  "toUpsertAll",
  "updateAll",
  "toUpdateAll",
  "deleteAll",
  "toDeleteAll",
  "create",
  "createOrThrow",
  "findBy",
  "findByOrThrow",
  "first",
  "last",
  "take",
  "count",
  "size",
  "isEmpty",
  "hasAny",
  "exists",
  "toArray",
  "toSql",
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

/** The Relation methods with overloads, typed by hand. */
interface OverloadedStatics {
  paginate: PaginateStatic;
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
    <
      C extends QueryableClass,
      const K extends readonly [
        keyof AttributesOf<InstanceType<C>> & string,
        keyof AttributesOf<InstanceType<C>> & string,
        ...(keyof AttributesOf<InstanceType<C>> & string)[],
      ],
    >(
      this: C,
      ...attributes: K
    ): Promise<{ -readonly [I in keyof K]: AttributesOf<InstanceType<C>>[K[I]] }[]>;
  };
}

/** A callback static, typed for the class it's declared on: `this.beforeSave((record) => …)`. */
type CallbackStatic = <C extends AbstractModelClass>(
  this: C,
  callback: Callback<InstanceType<C>>,
) => void;

/** Every callback kind as a static, each documented here, so its doc comment shows on hover. */
interface CallbackStatics {
  /** Runs before the validators, e.g. to normalize input. May `throw abort(reason)`. */
  beforeValidation: CallbackStatic;
  /** Runs after the validators, whether or not they passed. May `throw abort(reason)`. */
  afterValidation: CallbackStatic;
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
}

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
  CallbackStatics;

/**
 * Defines the statics on `base`: every Relation method, as Rails delegates them to `all`, and
 * a static for each callback kind, which declares a callback of that kind.
 */
export function defineStatics(base: typeof Model): void {
  for (const kind of callbackKinds) {
    defineStatic(base, kind, function (this: object, callback: Callback<Model>): void {
      declare(this, kind, callback);
    });
  }
  for (const name of [...relationMethods, "find", "pluck", "paginate"]) {
    defineStatic(base, name, function (this: QueryableClass, ...args: unknown[]): unknown {
      const relation = this.all() as unknown as Record<string, (...args: unknown[]) => unknown>;
      return relation[name]!(...args);
    });
  }
}

/** `method` as the static `name` of `base`, named and described as a class's own static is. */
function defineStatic(base: object, name: string, method: (...args: never) => unknown): void {
  Object.defineProperty(method, "name", { value: name });
  Object.defineProperty(base, name, { value: method, writable: true, configurable: true });
}
