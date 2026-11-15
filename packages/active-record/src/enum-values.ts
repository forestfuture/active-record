// An enum attribute's values (#340): its names, and the value each is stored as.

/**
 * An enum's values: its names, each stored as itself (a `string` attribute's only), or each name
 * with the value it's stored as (`{ draft: 0, published: 1 }`).
 */
export type EnumValues = readonly string[] | { readonly [name: string]: string | number };

/** The names an enum's values give its attribute: `"draft" | "published"`. */
export type EnumNames<E> = E extends readonly (infer N extends string)[] ? N : keyof E & string;

/** Whether `value` is an enum's values: a list of names, or an object of names and stored values. */
export function isEnumValues(value: unknown): value is EnumValues {
  if (Array.isArray(value)) return value.every((name) => typeof name === "string");
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((each) => typeof each === "string" || typeof each === "number");
}

/** Each name with the value it's stored as, in declaration order. */
export function enumEntries(values: EnumValues): [string, string | number][] {
  return Array.isArray(values)
    ? values.map((name: string) => [name, name])
    : Object.entries(values as Record<string, string | number>);
}

/** The names as a message lists them: `"draft", "published"`. */
export function listedNames(values: EnumValues): string {
  return enumEntries(values)
    .map(([name]) => JSON.stringify(name))
    .join(", ");
}
