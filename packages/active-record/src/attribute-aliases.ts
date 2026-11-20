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
  const given = Object.entries(declared).filter((entry): entry is [string, AliasAttribute] =>
    isAlias(entry[1]),
  );
  const aliases = new Map(given.map(([name, { aliasOf }]) => [name, aliasOf]));
  for (const [name, alias] of given) {
    const problem = aliasProblem(name, alias, aliases, attributes);
    if (problem !== undefined) throw new InvalidModel(`${where}${name}${problem}`);
  }
  return aliases;
}

/**
 * What's wrong with an alias, after its name: another key, a name that's an attribute already,
 * an alias of an alias, or of a name that isn't an attribute.
 */
function aliasProblem(
  name: string,
  alias: AliasAttribute,
  aliases: ReadonlyMap<string, string>,
  attributes: ReadonlyMap<string, unknown>,
): string | undefined {
  const { aliasOf } = alias;
  if (Object.keys(alias).length !== 1 || typeof aliasOf !== "string") {
    return ': an alias is { aliasOf: "attribute" }, and nothing else';
  }
  if (attributes.has(name)) return " is an attribute already, so it can't be an alias";
  const target = aliases.get(aliasOf);
  if (target !== undefined) return ` is an alias of ${aliasOf}, an alias itself; name ${target}`;
  if (!attributes.has(aliasOf)) return ` is an alias of ${aliasOf}, which isn't an attribute`;
  return undefined;
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
