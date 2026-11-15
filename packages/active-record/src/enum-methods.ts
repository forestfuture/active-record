// An enum attribute's methods (#340): a record's predicates (`isPublished()`) and `saveAs…` setters,
// a Model's scopes (`published()`, `notPublished()`), and their names.
import { enumEntries, type EnumNames, type EnumValues } from "./enum-values.ts";
import type { AttributeDefinition } from "./metadata.ts";
import type { ScopeStatic } from "./model.ts";

/** `S` in camelCase, as a method names it: `in_progress` → `inProgress`. */
type CamelCase<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : S;

/** How an enum's name reads inside a method's name: `in_progress` → `InProgress`. */
type MethodPart<N extends string> = Capitalize<CamelCase<N>>;

/** The names of a spec's enum, or never. */
type NamesOf<S> = S extends { enum: infer E extends EnumValues } ? EnumNames<E> : never;

/** Every predicate name the enums of the specs `A` give a record: `isDraft`, `isPublished`. */
type PredicateNames<A> = {
  [K in keyof A]: `is${MethodPart<NamesOf<A[K]>>}`;
}[keyof A];

/** Every setter name the enums of the specs `A` give a record: `saveAsDraft`, `saveAsPublished`. */
type SetterNames<A> = {
  [K in keyof A]: `saveAs${MethodPart<NamesOf<A[K]>>}`;
}[keyof A];

/**
 * What the enums of the specs `A` add to a record: a predicate for each name, and a setter that
 * assigns it and saves, with its `OrThrow`, as Rails' `published!` updates the record.
 */
export type EnumMethods<A> = { [P in PredicateNames<A>]: () => boolean } & {
  [P in SetterNames<A>]: () => Promise<boolean>;
} & { [P in `${SetterNames<A>}OrThrow`]: () => Promise<true> };

/** What a record's setters call: its `update` and `updateOrThrow`. */
interface Updatable {
  update(attributes: Record<string, unknown>): Promise<boolean>;
  updateOrThrow(attributes: Record<string, unknown>): Promise<true>;
}

/** How an enum's name reads inside a method's name, as `MethodPart` types it. */
export function methodPart(name: string): string {
  const [head = "", ...rest] = name.split("_");
  const camel = head + rest.map(capitalized).join("");
  return capitalized(camel);
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Defines each enum attribute's methods on `prototype`: `isPublished()` is `status === "published"`,
 * and `saveAsPublished()` is `update({ status: "published" })`, so it saves the record's other
 * changes too, as Rails' `published!` does.
 */
export function defineEnumMethods(
  prototype: object,
  definitions: ReadonlyMap<string, AttributeDefinition>,
): void {
  for (const [attribute, { enum: values }] of definitions) {
    if (values === undefined) continue;
    for (const [name] of enumEntries(values)) {
      const part = methodPart(name);
      defineMethod(prototype, `is${part}`, function (this: Record<string, unknown>) {
        return this[attribute] === name;
      });
      defineMethod(prototype, `saveAs${part}`, function (this: Updatable) {
        return this.update({ [attribute]: name });
      });
      defineMethod(prototype, `saveAs${part}OrThrow`, function (this: Updatable) {
        return this.updateOrThrow({ [attribute]: name });
      });
    }
  }
}

function defineMethod(target: object, name: string, method: (...args: never[]) => unknown): void {
  Object.defineProperty(method, "name", { value: name });
  Object.defineProperty(target, name, { value: method, writable: true, configurable: true });
}

/** How an enum's name reads as a scope: `in_progress` → `inProgress`. */
type ScopePart<N extends string> = Uncapitalize<MethodPart<N>>;

/** Every scope name the enums of the specs `A` give a Model: `draft`, `notDraft`, … */
type ScopeNames<A> = {
  [K in keyof A]: ScopePart<NamesOf<A[K]>> | `not${MethodPart<NamesOf<A[K]>>}`;
}[keyof A];

/** What the enums of the specs `A` add to a Model: a scope for each name, and a `not…` scope. */
export type EnumStatics<A> = { [P in ScopeNames<A>]: ScopeStatic<[]> };

/** The class an enum's scopes are declared on: what `this.scope(…)` is called on. */
interface ScopeDeclaring {
  scope(body: (relation: Conditioned) => Conditioned): unknown;
}

/** The part of a Relation an enum's scopes use. */
interface Conditioned {
  where(conditions: Record<string, unknown>): Conditioned;
  whereNot(conditions: Record<string, unknown>): Conditioned;
}

/**
 * Defines each enum attribute's scopes on `model`, as `this.scope(…)` statics: `published()` is
 * `where({ status: "published" })`, and `notPublished()` is `whereNot(…)`, as Rails' are.
 */
export function defineEnumStatics(
  model: object,
  definitions: ReadonlyMap<string, AttributeDefinition>,
): void {
  const declaring = model as ScopeDeclaring;
  for (const [attribute, { enum: values }] of definitions) {
    if (values === undefined) continue;
    for (const [name] of enumEntries(values)) {
      const part = methodPart(name);
      const scopes = {
        [uncapitalized(part)]: declaring.scope((q) => q.where({ [attribute]: name })),
        [`not${part}`]: declaring.scope((q) => q.whereNot({ [attribute]: name })),
      };
      for (const [scopeName, scope] of Object.entries(scopes)) {
        Object.defineProperty(model, scopeName, {
          value: scope,
          writable: true,
          configurable: true,
        });
      }
    }
  }
}

const uncapitalized = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
