// An enum attribute's methods (#340): a record's predicates (`isPublished()`), and their names.
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

/** What the enums of the specs `A` add to a record: a predicate for each name. */
export type EnumMethods<A> = { [P in PredicateNames<A>]: () => boolean };

/** How an enum's name reads inside a method's name, as `MethodPart` types it. */
export function methodPart(name: string): string {
  const [head = "", ...rest] = name.split("_");
  const camel = head + rest.map(capitalized).join("");
  return capitalized(camel);
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Defines each enum attribute's predicates on `prototype`: `isPublished()` is `status === "published"`. */
export function defineEnumMethods(
  prototype: object,
  definitions: ReadonlyMap<string, AttributeDefinition>,
): void {
  for (const [attribute, { enum: values }] of definitions) {
    if (values === undefined) continue;
    for (const [name] of enumEntries(values)) {
      defineMethod(prototype, `is${methodPart(name)}`, function (this: Record<string, unknown>) {
        return this[attribute] === name;
      });
    }
  }
}

function defineMethod(target: object, name: string, method: (...args: never[]) => unknown): void {
  Object.defineProperty(method, "name", { value: name });
  Object.defineProperty(target, name, { value: method, writable: true, configurable: true });
}
