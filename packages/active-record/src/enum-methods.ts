// An enum attribute's methods (#340): a record's predicates (`isPublished()`) and `saveAs…` setters, and their names.
import { enumEntries, type EnumNames, type EnumValues } from "./enum-values.ts";
import type { AttributeDefinition } from "./metadata.ts";

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
