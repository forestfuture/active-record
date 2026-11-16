// Validation contexts (#51): the context a record is validated in, and whether a rule's `on` runs in it.
import type { Model } from "./model.ts";
import { state } from "./record-state.ts";

/** A validation context: `"create"`, `"update"`, or a name the app chooses (`"signup"`). */
export type ValidationContext = "create" | "update" | (string & {});

/** The contexts every Model has: a new record's, and a saved one's. */
export const BUILT_IN_CONTEXTS: readonly string[] = ["create", "update"];

/** One context, or several: of those `X` names, when it's a Model's. */
export type ValidationContexts<X extends string = ValidationContext> = X | readonly X[];

/**
 * The contexts the Model class `C` can name: `"create"`, `"update"`, and those it lists in
 * `static validationContexts = [...] as const`.
 */
export type ContextOf<C> =
  | "create"
  | "update"
  | (C extends { validationContexts: readonly (infer N extends string)[] } ? N : never);

/** The callback kinds that take `on`, to run only in some contexts. */
export const VALIDATION_CALLBACK_KINDS = ["beforeValidation", "afterValidation"] as const;

/** The options of `beforeValidation` and `afterValidation`. */
export interface ValidationCallbackOptions<X extends string = ValidationContext> {
  /** Only run the callback in this validation context, or these. */
  on?: ValidationContexts<X>;
}

/** The contexts each callback `inContext` made runs in, so the Model's first use can check them. */
const callbackContexts = new WeakMap<object, readonly string[]>();

/** `callback`, run only while its record is validated in one of the contexts in `on`. */
export function inContext(
  callback: (record: Model) => unknown,
  { on }: ValidationCallbackOptions,
): (record: Model) => unknown {
  const narrowed = (record: Model) =>
    isInContext(record[state].validationContexts, { on }) ? callback(record) : undefined;
  if (on !== undefined) callbackContexts.set(narrowed, listOf(on));
  return narrowed;
}

/** The contexts a validation callback runs in: those of its `on`, if it has one. */
export function contextsOfCallback(callback: object): readonly string[] {
  return callbackContexts.get(callback) ?? [];
}

/** The options of `save` and `saveOrThrow`. */
export interface SaveOptions {
  /** Validate in this context (`"signup"`), or these, in place of `"create"` or `"update"`. */
  context?: ValidationContexts;
}

/**
 * The contexts a record is validated in: those given, or else `"create"` while it's new and
 * `"update"` once it's saved.
 */
export function contextsOf(record: Model, given?: ValidationContexts): readonly string[] {
  if (given !== undefined) return listOf(given);
  return [record[state].isNew ? "create" : "update"];
}

/**
 * The contexts given, as a list, if any is custom: not `"create"` or `"update"`. Only such a context
 * reaches the records validated with a record.
 */
export function customContextOf(given?: ValidationContexts): readonly string[] | undefined {
  if (given === undefined) return undefined;
  const contexts = listOf(given);
  return contexts.some((context) => !BUILT_IN_CONTEXTS.includes(context)) ? contexts : undefined;
}

/** The context names a rule's `on` or `exceptOn` gives. */
export function listOf(contexts: ValidationContexts): readonly string[] {
  return typeof contexts === "string" ? [contexts] : contexts;
}

/** Whether one of `contexts` is listed in `listed`. */
function isListedIn(contexts: readonly string[], listed: ValidationContexts): boolean {
  return listOf(listed).some((context) => contexts.includes(context));
}

/**
 * Whether a rule runs in `contexts`: one in its `on` (every context without one), and none in its
 * `exceptOn`.
 */
export function isInContext(
  contexts: readonly string[],
  { on, exceptOn }: { on?: ValidationContexts; exceptOn?: ValidationContexts },
): boolean {
  if (on !== undefined && !isListedIn(contexts, on)) return false;
  return exceptOn === undefined || !isListedIn(contexts, exceptOn);
}
