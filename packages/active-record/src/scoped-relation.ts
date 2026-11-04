// Scopes: a Model's scope statics, and the Relations that carry them as methods.
import { InvalidModel } from "./errors.ts";
import type { Executor } from "./executor.ts";
import { ancestors } from "./ancestors.ts";
import type { Model, ModelClass, ScopesOf } from "./model.ts";
import { applyScope, Relation, type RelationArgs, type Scope, type Scoped } from "./relation.ts";

type RelationClass = new (...args: RelationArgs<Model>) => Relation<Model>;

// Module-level, but not request state (ADR-0003): derived only from a Model's scope statics.
const relationClasses = new WeakMap<
  object,
  { Class: RelationClass; scopes: object[]; names: Map<object, string> }
>();

/** Each scope static, to its body: what `Product.newest()` and `relation.newest()` run. */
export const scopeBodies = new WeakMap<object, Scope<Model>>();

// Module-level, but not request state (ADR-0003): what this module needs from model.ts,
// handed over once it has loaded, so this module imports neither it nor associations.ts.

/** The library's base class: where a Model's scopes stop, and whose statics no scope may take. */
let base: { root: object; statics: ReadonlySet<string> } | undefined;

/** Makes a Model ready on first use (verified, its accessors installed, its declarations sealed). */
let ready: ((model: ModelClass) => void) | undefined;

/** @internal Called once by model.ts, after Model and its statics are defined. */
export function useModelBase(root: object, readyModel: (model: ModelClass) => void): void {
  base = { root, statics: new Set(Object.getOwnPropertyNames(root)) };
  ready = readyModel;
}

/** What model.ts handed over; missing means a load order bug, not a user's. */
function setUp(): {
  root: object;
  statics: ReadonlySet<string>;
  ready: (model: ModelClass) => void;
} {
  if (base === undefined || ready === undefined) {
    throw new Error("d1-record: model.ts must load before a Model is used");
  }
  return { ...base, ready };
}

/** A Model's scopes, by name: its statics made with `this.scope(…)`, the nearest class's first. */
function scopesOf(model: ModelClass): Map<string, object> {
  const scopes = new Map<string, object>();
  for (const each of ancestors(model)) {
    if (each === setUp().root) break;
    for (const name of Object.getOwnPropertyNames(each)) {
      const value: unknown = (each as unknown as Record<string, unknown>)[name];
      if (typeof value === "function" && scopeBodies.has(value) && !scopes.has(name)) {
        scopes.set(name, value);
      }
    }
  }
  return scopes;
}

/** The name `model` (or a class it extends) gives the scope static `scoped`, once it's been used. */
export function scopeName(model: ModelClass, scoped: object): string {
  const name = relationClasses.get(model)?.names.get(scoped);
  if (name === undefined) {
    throw new InvalidModel(`${model.name} has a scope that isn't one of its statics`);
  }
  return name;
}

/** Rejects a scope named like a Relation method or a Model static, or "then". */
function requireScopeName(model: ModelClass, name: string): void {
  // "then" would make Relations awaitable.
  // A Model's own statics are taken too, besides the Relation methods it mirrors.
  if (name === "then" || name in Relation.prototype || setUp().statics.has(name)) {
    throw new InvalidModel(
      `${model.name} declares a scope "${name}", which is the name of a Relation method or a Model static; rename the scope`,
    );
  }
}

function relationClassFor(model: ModelClass): RelationClass {
  const scopes = scopesOf(model);
  // The scope statics themselves, so a replaced one (same name, new scope) is noticed too.
  const signature = [...scopes.values()];
  const cached = relationClasses.get(model);
  if (cached !== undefined) {
    const same =
      cached.scopes.length === signature.length &&
      cached.scopes.every((scope, index) => scope === signature[index]);
    if (!same) {
      throw new InvalidModel(
        `${model.name}'s scopes changed after its first use; declare them once, in the class body (static name = this.scope(…))`,
      );
    }
    return cached.Class;
  }
  // The library's own Relations: constructible here, though Relation's constructor is protected.
  const ScopedRelation = class extends Relation<Model> {
    constructor(parts: unknown) {
      super(parts);
    }
  };
  for (const [name, scoped] of scopes) {
    requireScopeName(model, name);
    const body = scopeBodies.get(scoped)!;
    Object.defineProperty(ScopedRelation.prototype, name, {
      value(this: Relation<Model>, ...args: unknown[]) {
        return this[applyScope](name, body, args);
      },
    });
  }
  const names = new Map([...scopes].map(([name, scoped]) => [scoped, name]));
  relationClasses.set(model, { Class: ScopedRelation, scopes: signature, names });
  return ScopedRelation;
}

/** A fresh Relation over all of `model`'s records, with the Model's scopes as methods. */
export function relationFor<C extends ModelClass>(
  executor: Executor,
  model: C,
): Scoped<InstanceType<C>, ScopesOf<C>> {
  // Every query starts here, so the Model is made ready here, however it was reached.
  setUp().ready(model);
  const Class = relationClassFor(model) as unknown as new (
    ...args: RelationArgs<InstanceType<C>>
  ) => Scoped<InstanceType<C>, ScopesOf<C>>;
  return new Class({ executor, model: model as unknown as ModelClass<InstanceType<C>> });
}
