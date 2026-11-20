// Attribute aliases (#509): another name for an attribute (`title: { aliasOf: "name" }`), declared
// with a Model's attributes, its accessors, and the one place an alias resolves to its attribute.
import { InvalidModel } from "./errors.ts";
import { state } from "./record-state.ts";

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

/** The declared attributes `O` without their aliases. */
export type WithoutAliases<O> = {
  [K in keyof O as O[K] extends { aliasOf: string } ? never : K]: O[K];
};

/** Whether a declared attribute is an alias: an object with `aliasOf`. */
export function isAlias(declared: unknown): declared is AliasAttribute {
  return typeof declared === "object" && declared !== null && "aliasOf" in declared;
}

/** The aliases a Model's declared attributes hold, by alias, each to the attribute it names. */
export function aliasesIn(
  model: string,
  declared: Readonly<Record<string, unknown>>,
  attributes: ReadonlyMap<string, unknown>,
): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  for (const [name, each] of Object.entries(declared)) {
    if (!isAlias(each)) continue;
    if (!attributes.has(each.aliasOf)) {
      throw new InvalidModel(
        `${model}.${name} is an alias of ${each.aliasOf}, which isn't an attribute`,
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
  model: { readonly attributeAliases: ReadonlyMap<string, string> },
  name: string,
): string {
  return model.attributeAliases.get(name) ?? name;
}

/** Each alias's accessors on a prototype, reading and writing the attribute it names. */
export function defineAliasAccessors(
  prototype: object,
  aliases: ReadonlyMap<string, string>,
): void {
  type Record = {
    [state]: { read(name: string): unknown; write(name: string, value: unknown): void };
  };
  for (const [alias, name] of aliases) {
    Object.defineProperty(prototype, alias, {
      get(this: Record) {
        return this[state].read(name);
      },
      set(this: Record, value: unknown) {
        this[state].write(name, value);
      },
    });
  }
}
