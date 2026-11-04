// A Model's declared callbacks, validations and error messages, inherited, and sealed on its first use.
import { ancestors } from "./ancestors.ts";
import { InvalidModel } from "./errors.ts";
import type { Callback, Model } from "./model.ts";
import type { ErrorMessages } from "./error-messages.ts";
import type { Validation } from "./validations.ts";

/**
 * Per-Model declarations (validations, callbacks, …), keyed by Model class. A subclass starts
 * from a copy of its parent's list, so declaring on it never changes the parent.
 *
 * Module-level, but not request state (ADR-0003): declarations are made once, when a Model
 * class is defined, and only read afterwards.
 */
const registry = new WeakMap<object, Map<string, readonly unknown[]>>();

/** The declarations each class made itself, without its parent's, for reading class by class. */
const ownRegistry = new WeakMap<object, Map<string, readonly unknown[]>>();

/** Models that have been used; their declarations can no longer change. */
const sealed = new WeakSet<object>();

/**
 * Called on a Model's first use. From then on, declaring on it throws: declarations belong in
 * the class's `static {}` block, never in request code, where they'd leak into every request.
 */
export function seal(model: object): void {
  sealed.add(model);
}

/** Whether a Model has been used, so its declarations, and its ancestors', can no longer change. */
export function isSealed(model: object): boolean {
  return sealed.has(model);
}

/** Callbacks that run before the D1 write, and may `throw abort(reason)` to refuse it. */
export type BeforeCallbackKind =
  | "beforeValidation"
  | "afterValidation"
  | "beforeSave"
  | "beforeCreate"
  | "beforeUpdate"
  | "beforeDestroy";

/** Callbacks that run after a successful write; `abort()` there is `AbortAfterPersistence`. */
export type AfterCallbackKind = "afterCreate" | "afterUpdate" | "afterSave" | "afterDestroy";

export type CallbackKind = BeforeCallbackKind | AfterCallbackKind;

/** Every kind of per-Model declaration, and what one entry of it is. */
export type Declarations = {
  validations: Validation;
  errorMessages: ErrorMessages;
  humanAttributeNames: Readonly<Record<string, string>>;
} & {
  [K in CallbackKind]: Callback<Model>;
};

/** The declarations of `kind` for `model`: its own, or else its nearest ancestor's. */
export function declared<K extends keyof Declarations>(
  model: object,
  kind: K,
): readonly Declarations[K][] {
  for (const current of ancestors(model)) {
    const list = registry.get(current)?.get(kind);
    if (list !== undefined) return list as readonly Declarations[K][];
  }
  return [];
}

/** The declarations of `kind` that `model` and each class it extends made themselves, nearest first. */
export function declaredByClass<K extends keyof Declarations>(
  model: object,
  kind: K,
): { from: object; values: readonly Declarations[K][] }[] {
  return ancestors(model).flatMap((from) => {
    const values = ownRegistry.get(from)?.get(kind) as readonly Declarations[K][] | undefined;
    return values === undefined ? [] : [{ from, values }];
  });
}

/** Adds a declaration of `kind` to `model`, copying its inherited list first. */
export function declare<K extends keyof Declarations>(
  model: object,
  kind: K,
  entry: Declarations[K],
): void {
  if (sealed.has(model)) {
    const { name } = model as { name: string };
    throw new InvalidModel(
      `${name} has already been used; declare validations, callbacks and messages in its static {} block`,
    );
  }
  listsOf(registry, model).set(kind, [...declared(model, kind), entry]);
  const own = listsOf(ownRegistry, model);
  own.set(kind, [...(own.get(kind) ?? []), entry]);
}

/** `model`'s lists in a registry, by kind, made empty the first time. */
function listsOf(
  lists: WeakMap<object, Map<string, readonly unknown[]>>,
  model: object,
): Map<string, readonly unknown[]> {
  const found = lists.get(model) ?? new Map<string, readonly unknown[]>();
  lists.set(model, found);
  return found;
}
