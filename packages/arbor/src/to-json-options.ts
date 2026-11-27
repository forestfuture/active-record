// What `toJSON` sends: a record's attributes, less those never sent, and what its options add.
import { attributeName } from "./attribute-aliases.ts";
import { associationOf, associationsOf } from "./association-fields.ts";
import { declared } from "./declarations.ts";
import type { AssociationName, AttributesOf, Model, ModelClass, TargetRecord } from "./model.ts";
import { secretAttributeNames } from "./secure-passwords.ts";
import { confirmationNames } from "./validations.ts";

/**
 * What `record.toJSON(options)` sends besides the record's attributes: `include` names loaded
 * associations as `includes()` does (`"posts"`, `["posts", "profile"]`, `{ posts: "comments" }`).
 * `only` or `except`, not both, picks the attributes sent, and `methods` adds the values of the
 * record's getters and methods that take no arguments.
 */
export type ToJSONOptions<R> = {
  readonly include?: Include<R> | readonly Include<R>[];
  readonly methods?: readonly MethodName<R>[];
} & (
  | { readonly only?: readonly AttributeName<R>[]; readonly except?: never }
  | { readonly except?: readonly AttributeName<R>[]; readonly only?: never }
);

/**
 * What `include` takes for records `R`: what `includes()` does, or under an association's name,
 * the options its records are serialized with (`{ posts: { only: ["title"] } }`).
 */
type Include<R> = R extends unknown
  ?
      | AssociationName<R>
      | {
          readonly [K in AssociationName<R>]?:
            | Include<TargetRecord<R[K]>>
            | readonly Include<TargetRecord<R[K]>>[]
            | ToJSONOptions<TargetRecord<R[K]>>;
        }
  : never;

/**
 * A record's getter, or its method that takes no arguments, whose value isn't a promise, as
 * `toJSON` can't wait for one.
 */
type MethodName<R> = {
  [K in keyof R]: R[K] extends () => infer T
    ? Unawaited<T, K>
    : R[K] extends (...args: never[]) => unknown
      ? never
      : Unawaited<R[K], K>;
}[keyof R] &
  string;

/** `K`, unless `T` is a promise. */
type Unawaited<T, K> = T extends PromiseLike<unknown> ? never : K;

/** One of a record's attributes' names, alias names included. */
type AttributeName<R> = keyof AttributesOf<R> & string;

/** Options as `toJSON` reads them, whatever the record's type checked. */
export interface GivenOptions {
  readonly include?: unknown;
  readonly only?: readonly string[];
  readonly except?: readonly string[];
  readonly methods?: readonly string[];
}

/** The options a nested association is serialized with, if any. */
type Nested = GivenOptions | undefined;

/**
 * A record's `attributes` as JSON-ready values (dates as ISO strings), without what's never sent:
 * the Model's `hiddenAttributes`, the virtual attributes its `confirmation` rules read, and its
 * secrets. Then what `options` add: each included association's loaded records, each serialized
 * by its own `toJSON`.
 */
export function recordJSON(
  record: Model,
  attributes: Record<string, unknown>,
  options: GivenOptions,
): Record<string, unknown> {
  const model = record.constructor as ModelClass;
  const result = Object.fromEntries(
    [
      ...chosenAttributes(model, attributes, options),
      ...(options.methods ?? []).map((name) => [name, methodValue(record, name)] as const),
    ].map(([name, value]) => [name, value instanceof Date ? value.toISOString() : value]),
  );
  for (const [name, nested] of includedAssociations(model, options.include)) {
    result[name] = serializeLoaded(record.loaded(name as never), nested);
  }
  return result;
}

/**
 * The attributes `toJSON` sends: those `only` names, if it's given, else those `except` doesn't,
 * never one `neverSent` lists.
 */
function chosenAttributes(
  model: ModelClass,
  attributes: Record<string, unknown>,
  options: GivenOptions,
): [string, unknown][] {
  const hidden = neverSent(model);
  const only = attributesNamed(model, options.only, "only");
  const except = only === undefined ? attributesNamed(model, options.except, "except") : undefined;
  return Object.entries(attributes).filter(
    ([name]) => !hidden.includes(name) && (only?.includes(name) ?? !except?.includes(name)),
  );
}

/**
 * The attributes `only` or `except` names, an alias as the attribute it names. A name that's no
 * attribute of the Model is a `TypeError`, so a typo in `except` can't send what it meant to drop.
 */
function attributesNamed(
  model: ModelClass,
  given: readonly string[] | undefined,
  option: "only" | "except",
): string[] | undefined {
  return given?.map((name) => {
    const attribute = attributeName(model, name);
    if (!model.attributeDefinitions.has(attribute)) {
      throw new TypeError(
        `${model.name} has no attribute "${name}"; toJSON's ${option} names attributes exactly`,
      );
    }
    return attribute;
  });
}

/**
 * The attributes `toJSON` never sends: the Model's `hiddenAttributes`, the virtual attributes its
 * `confirmation` rules read, and each secure password, its confirmation, challenge and digest,
 * and each secure token (#355).
 */
function neverSent(model: ModelClass): string[] {
  return [
    ...model.hiddenAttributes,
    ...confirmationNames(declared(model, "validations")),
    ...secretAttributeNames(model.attributeDefinitions),
  ];
}

/**
 * What `methods` adds for `name`: a getter's value, or what a method returns. A name the record
 * has no member for, and a promise, are `TypeError`s.
 */
function methodValue(record: Model, name: string): unknown {
  const model = record.constructor as ModelClass;
  if (!(name in record)) {
    throw new TypeError(
      `${model.name} has no method or getter "${name}"; toJSON's methods names the record's own`,
    );
  }
  const member = (record as unknown as Record<string, unknown>)[name];
  const value = typeof member === "function" ? (member as () => unknown).call(record) : member;
  if (typeof (value as PromiseLike<unknown> | undefined)?.then === "function") {
    throw new TypeError(
      `${model.name}'s "${name}" returned a promise; toJSON's methods can't wait for one`,
    );
  }
  return value;
}

/** Each association an `include` names, with the options its records are serialized with. */
function includedAssociations(model: ModelClass, spec: unknown): [string, Nested][] {
  if (spec === undefined) return [];
  if (typeof spec === "string") return [[spec, undefined]];
  if (Array.isArray(spec)) return spec.flatMap((each) => includedAssociations(model, each));
  return Object.entries(spec as Record<string, unknown>).map(([name, value]) => [
    name,
    nestedOptions(model, name, value),
  ]);
}

/** The names that make an object under an association's name its options, not what it includes. */
const optionNames = ["include", "only", "except", "methods"];

/**
 * The options for association `name`'s records: `value` itself when it names an option
 * (`{ only: ["title"] }`), else what they include (`"comments"`, `{ comments: "author" }`).
 */
function nestedOptions(model: ModelClass, name: string, value: unknown): Nested {
  const given =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.keys(value).filter((key) => optionNames.includes(key))
      : [];
  if (given.length === 0) return { include: value };
  checkUnambiguous(model, name, given);
  return value as GivenOptions;
}

/**
 * Throws `TypeError` when an option given under association `name` is also the name of one of its
 * records' associations, as it could be either.
 */
function checkUnambiguous(model: ModelClass, name: string, given: readonly string[]): void {
  const { target, targets } = associationOf(model, name);
  for (const each of targets?.() ?? [target()]) {
    const clash = given.find((option) => associationsOf(each).has(option));
    if (clash !== undefined) {
      throw new TypeError(
        `${each.name} has an association named "${clash}", so toJSON can't tell whether { ${clash} } under "${name}" names it or is an option`,
      );
    }
  }
}

/** A loaded association as JSON: a list of records, a record, or null. */
function serializeLoaded(value: unknown, options: Nested): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((each: Model) => each.toJSON(options as never));
  return (value as Model).toJSON(options as never);
}
