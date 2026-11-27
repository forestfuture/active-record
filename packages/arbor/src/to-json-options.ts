// What `toJSON` sends: a record's attributes, less those never sent, and what its options add.
import { declared } from "./declarations.ts";
import type { IncludeSpec, Model, ModelClass } from "./model.ts";
import { secretAttributeNames } from "./secure-passwords.ts";
import { confirmationNames } from "./validations.ts";

/**
 * What `record.toJSON(options)` sends besides the record's attributes: `include` names loaded
 * associations as `includes()` does (`"posts"`, `["posts", "profile"]`, `{ posts: "comments" }`).
 */
export interface ToJSONOptions<R> {
  readonly include?: IncludeSpec<R> | readonly IncludeSpec<R>[];
}

/** The options a nested association is serialized with, if any. */
type Nested = ToJSONOptions<Model> | undefined;

/**
 * A record's `attributes` as JSON-ready values (dates as ISO strings), without what's never sent:
 * the Model's `hiddenAttributes`, the virtual attributes its `confirmation` rules read, and its
 * secrets. Then what `options` add: each included association's loaded records, each serialized
 * by its own `toJSON`.
 */
export function recordJSON(
  record: Model,
  attributes: Record<string, unknown>,
  options: ToJSONOptions<Model>,
): Record<string, unknown> {
  const hidden = neverSent(record.constructor as ModelClass);
  const result = Object.fromEntries(
    Object.entries(attributes)
      .filter(([name]) => !hidden.includes(name))
      .map(([name, value]) => [name, value instanceof Date ? value.toISOString() : value]),
  );
  for (const [name, nested] of includedAssociations(options.include)) {
    result[name] = serializeLoaded(record.loaded(name as never), nested);
  }
  return result;
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

/** Each association an `include` names, with the options its records are serialized with. */
function includedAssociations(spec: unknown): [string, Nested][] {
  if (spec === undefined) return [];
  if (typeof spec === "string") return [[spec, undefined]];
  if (Array.isArray(spec)) return spec.flatMap(includedAssociations);
  return Object.entries(spec as Record<string, unknown>).map(([name, value]) => [
    name,
    { include: value } as Nested,
  ]);
}

/** A loaded association as JSON: a list of records, a record, or null. */
function serializeLoaded(value: unknown, options: Nested): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((each: Model) => each.toJSON(options));
  return (value as Model).toJSON(options);
}
