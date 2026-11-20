// Attribute aliases (#509): another name for an attribute (`title: { aliasOf: "name" }`), declared
// with a Model's attributes, and the one place an alias resolves to its attribute.
import { InvalidModel } from "./errors.ts";

/** An alias in `static attributes` or `define`: `title: { aliasOf: "name" }` reads as "title is an alias of name". */
export interface AliasAttribute {
  readonly aliasOf: string;
}

/** The aliases among a Model's declared attributes `O`, each typed as the attribute it names in `S`. */
export type AliasSpecs<S, O> = {
  -readonly [K in keyof O as O[K] extends { aliasOf: keyof S } ? K : never]: O[K] extends {
    aliasOf: infer T extends keyof S;
  }
    ? S[T]
    : never;
};

/** `define`'s attributes `A`, with each alias typed as the attribute it names; `A` itself without one. */
export type DefinedSpecs<A> = [AliasNames<A>] extends [never]
  ? A
  : WithoutAliases<A> & AliasSpecs<WithoutAliases<A>, A>;

/** The names of the aliases among `A`. */
type AliasNames<A> = { [K in keyof A]: A[K] extends { aliasOf: string } ? K : never }[keyof A];

/** The declared attributes `O` without their aliases. */
export type WithoutAliases<O> = {
  [K in keyof O as O[K] extends { aliasOf: string } ? never : K]: O[K];
};

/** Whether a declared attribute is an alias: an object with `aliasOf`. */
export function isAlias(declared: unknown): declared is AliasAttribute {
  return typeof declared === "object" && declared !== null && "aliasOf" in declared;
}

/**
 * The aliases a Model's declared attributes hold, by alias, each to the attribute it names; `where`
 * prefixes an alias's name in an error (`"Post."`, or nothing for `define`).
 */
export function aliasesIn(
  where: string,
  declared: Readonly<Record<string, unknown>>,
  attributes: ReadonlyMap<string, unknown>,
): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  for (const [name, each] of Object.entries(declared)) {
    if (!isAlias(each)) continue;
    if (!attributes.has(each.aliasOf)) {
      throw new InvalidModel(
        `${where}${name} is an alias of ${each.aliasOf}, which isn't an attribute`,
      );
    }
    aliases.set(name, each.aliasOf);
  }
  return aliases;
}

/**
 * The attribute `name` names: itself, or the one it's an alias of. Every name a query, a write, a
 * validation or a change-tracking method takes goes through it.
 */
export function attributeName(
  model: { readonly attributeAliases?: ReadonlyMap<string, string> },
  name: string,
): string {
  return model.attributeAliases?.get(name) ?? name;
}
