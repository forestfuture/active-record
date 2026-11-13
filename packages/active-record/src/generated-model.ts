// A generated Model (`class Post extends ApplicationRecord {}`): the generated schema's types, its
// table, primary key and attributes from the schema its base class holds (overrides checked),
// settled on first use, and its binding (#232).
import type { SchemaAdapter } from "./adapter.ts";
import { ancestors } from "./ancestors.ts";
import { InvalidModel } from "./errors.ts";
import {
  define,
  type AttributeDefinition,
  type AttributeSpecs,
  type AttributeType,
  type ValueSource,
} from "./metadata.ts";
import { state } from "./record-state.ts";
import {
  applyOverride,
  isAttributeType,
  isSpecOverride,
  overridableKeyNames,
  specProblem,
  type SpecOverride,
} from "./spec-keys.ts";
import { bindTable, modelNameOf, ownValueSetter, tableize } from "./table-names.ts";

/** One table in a generated schema: its attributes, and which is the primary key. */
export interface TableSchema {
  readonly attributes: AttributeSpecs;
  readonly primaryKey: string;
}

/** A generated schema's tables, by name (`tables` in `src/db/schema.ts`). */
export type TableSchemas = Readonly<Record<string, TableSchema>>;

/**
 * A change to a generated attribute: its type alone, or its type, nullability, default and
 * `generateId`, typed so `generateId` goes only with a string, and never with a default (#99).
 */
type AttributeOverride =
  | AttributeType
  | (Pick<SpecOverride, "null"> & { type?: "string"; storage?: never } & ValueSource)
  | (Pick<SpecOverride, "null" | "default"> & {
      type: Exclude<AttributeType, "string" | "datetime">;
      generateId?: false;
      storage?: never;
    })
  | (Pick<SpecOverride, "null" | "default" | "storage"> & {
      type: "datetime";
      generateId?: false;
    });

/** The type a spec declares, written either way. */
type TypeOf<S> = S extends AttributeType ? S : S extends { type: infer T } ? T : never;
/** Whether a spec's attribute can be `null`. */
type NullOf<S> = S extends { null: false } ? false : true;

/** An attribute's spec with its override applied. */
type Overridden<S, O> = O extends AttributeType
  ? { type: O; null: NullOf<S> }
  : O extends object
    ? {
        type: O extends { type: infer T extends AttributeType } ? T : TypeOf<S>;
        null: O extends { null: infer N extends boolean } ? N : NullOf<S>;
      }
    : S;

/** A table's attributes after its overrides: changed ones merged, ignored ones gone. */
export type OverriddenSpecs<A, O> = {
  -readonly [
    K in keyof A as K extends keyof O ? (O[K] extends false ? never : K) : K
  ]: K extends keyof O ? Overridden<A[K], O[K]> : A[K];
};

/** `S` as attribute specs, without widening it to an index signature (which would type any name). */
export type AsSpecs<S> = S extends AttributeSpecs ? S : never;

/**
 * A generated Model's changes to its table's attributes (`static override attributes = {...} as
 * const`): a type name, a spec's changes, or `false` to ignore the column.
 */
export type AttributeOverrides = Readonly<Record<string, AttributeOverride | false>>;

/** What `active-record schema` generates for one database: its adapter, its tables, and its Models. */
export interface DatabaseSchema {
  readonly adapter: SchemaAdapter;
  readonly tables: TableSchemas;
  /**
   * The Models the schema was generated for: each one's `modelName`, and its table. Absent only
   * while `active-record schema` loads the Models, before it has found them; then nothing is checked.
   */
  readonly models?: Readonly<Record<string, string>>;
}

/** The statics a generated Model, or a class it's built on, may declare. */
interface GeneratedClass {
  readonly name: string;
  readonly prototype: object;
  schema?: DatabaseSchema;
  abstract?: boolean;
  table?: string;
  primaryKey?: string;
  attributes?: Readonly<Record<string, unknown>>;
}

/** A generated Model's table, primary key and attributes, as found in its schema. */
interface Generated {
  readonly table: string;
  readonly primaryKey: string;
  readonly definitions: ReadonlyMap<string, AttributeDefinition>;
  readonly ignoresColumns: boolean;
}

const noAttributes: ReadonlyMap<string, AttributeDefinition> = new Map();

/**
 * What each generated Model settled on when it was first used, by class (a subclass shares its
 * parent's). Until then, they're found again on each read, since a `static {}` block reads them
 * before the statics declared after it exist. Module-level, but not request state (ADR-0003):
 * derived only from the classes.
 */
const settled = new WeakMap<object, Generated>();

/** Whether a class is a base for Models, not a Model: it holds a schema, or says it's abstract. */
export function isBase(each: object): boolean {
  return (
    Object.hasOwn(each, "schema") ||
    (Object.hasOwn(each, "abstract") && (each as GeneratedClass).abstract === true)
  );
}

/**
 * The class a generated Model's table belongs to (the one directly below its nearest base), and
 * the schema that base holds or inherits. None for a base itself, or a hand-declared Model (one
 * whose class, or a parent's, declares its own attributes).
 */
function tableOwnerOf(
  model: object,
): { owner: GeneratedClass; schema: DatabaseSchema } | undefined {
  const chain = ancestors(model);
  const index = chain.findIndex(isBase);
  const declared = chain
    .slice(0, index)
    .some((each) => Object.hasOwn(each, "attributeDefinitions"));
  if (index <= 0 || declared) return undefined;
  const holder = chain.slice(index).find((each) => Object.hasOwn(each, "schema"));
  const schema = (holder as GeneratedClass | undefined)?.schema;
  return schema === undefined ? undefined : { owner: chain[index - 1] as GeneratedClass, schema };
}

/** The attribute accessors on a prototype, reading and writing a record's values. */
export function defineAttributeAccessors(prototype: object, names: Iterable<string>): void {
  type Record = {
    [state]: { read(name: string): unknown; write(name: string, value: unknown): void };
  };
  for (const name of names) {
    Object.defineProperty(prototype, name, {
      get(this: Record) {
        return this[state].read(name);
      },
      set(this: Record, value: unknown) {
        this[state].write(name, value);
      },
    });
  }
}

/**
 * A Model the schema wasn't generated for, or whose table has changed since, as an
 * `InvalidModel`: what stops a dev server, which doesn't type-check. A schema with no list of
 * Models, as `active-record schema` loads the Models with before it has found them, checks none.
 */
function rejectUngenerated(name: string, table: string, schema: DatabaseSchema): void {
  if (schema.models === undefined) return;
  const generatedTable = Object.hasOwn(schema.models, name) ? schema.models[name] : undefined;
  if (generatedTable === undefined) {
    throw new InvalidModel(`${name} isn't in the generated schema; run active-record schema`);
  }
  if (generatedTable !== table) {
    throw new InvalidModel(
      `${name}'s table is ${table}, but the generated schema has ${generatedTable}; run active-record schema`,
    );
  }
}

/**
 * Finds a generated Model's table in its schema, and its attributes after its overrides. The
 * schema lists it by its `modelName`, which its table is inferred from too.
 */
function find(owner: GeneratedClass, schema: DatabaseSchema): Generated {
  const name = modelNameOf(owner);
  const table = Object.hasOwn(owner, "table") ? owner.table! : tableize(name);
  rejectUngenerated(name, table, schema);
  const tableSchema = Object.hasOwn(schema.tables, table) ? schema.tables[table] : undefined;
  if (tableSchema === undefined) {
    throw new InvalidModel(`${owner.name}'s table, ${table}, isn't in the generated schema`);
  }
  const { specs, ignoresColumns } = specsFor(owner.name, tableSchema, owner.attributes ?? {});
  const definitions = new Map(
    Object.entries(specs).map(([name, spec]) => [name, define(name, spec)]),
  );
  const primaryKey = Object.hasOwn(owner, "primaryKey")
    ? owner.primaryKey!
    : tableSchema.primaryKey;
  return { table, primaryKey, definitions, ignoresColumns };
}

/**
 * A generated Model's table, primary key and attributes; undefined for any other class. What it
 * settled on, once it's been used; otherwise found again.
 */
function generated(model: object): Generated | undefined {
  const found = settled.get(model);
  if (found !== undefined) return found;
  const place = tableOwnerOf(model);
  if (place === undefined) return undefined;
  return settled.get(place.owner) ?? find(place.owner, place.schema);
}

/**
 * Settles a generated Model's table and attributes the first time it's used, when its class
 * and its statics are all defined: binds its table, and defines its attribute accessors.
 */
export function settleGenerated(model: object): void {
  if (settled.has(model)) return;
  const place = tableOwnerOf(model);
  if (place === undefined) return;
  const { owner } = place;
  let found = settled.get(owner);
  if (found === undefined) {
    found = find(owner, place.schema);
    bindTable(owner, found.table, { ignoresColumns: found.ignoresColumns });
    defineAttributeAccessors(owner.prototype, found.definitions.keys());
    settled.set(owner, found);
  }
  settled.set(model, found);
}

/**
 * Whether a class's attributes are fixed: a hand-declared Model's are when it's defined, and a
 * generated Model's when it's first used. A base class has none, which is fixed too.
 */
export function attributesSettled(model: object): boolean {
  return settled.has(model) || tableOwnerOf(model) === undefined;
}

/** Whether a class is a generated Model: built on a base holding a generated schema. */
export function isGenerated(model: object): boolean {
  return generated(model) !== undefined;
}

/** The adapter the generated schema a Model's base holds names, if any. */
export function schemaAdapter(model: object): SchemaAdapter | undefined {
  const holder = ancestors(model).find((each) => Object.hasOwn(each, "schema"));
  return (holder as GeneratedClass | undefined)?.schema?.adapter;
}

/**
 * The library's base class's `table`, `primaryKey` and `attributeDefinitions`: a generated
 * Model's from its schema, and otherwise none (a hand-declared Model sets its own).
 */
export function defineGeneratedStatics(root: object): void {
  const statics: Record<string, (model: object) => unknown> = {
    table: (model) => generated(model)?.table ?? "",
    primaryKey: (model) => generated(model)?.primaryKey ?? "id",
    attributeDefinitions: (model) => generated(model)?.definitions ?? noAttributes,
  };
  for (const [name, read] of Object.entries(statics)) {
    Object.defineProperty(root, name, {
      configurable: true,
      get(this: object) {
        return read(this);
      },
      set: ownValueSetter(name),
    });
  }
}

/**
 * An override as given, checked (TypeScript checks it too, but not in plain JavaScript or past
 * a cast): `false` to ignore the column, or the spec changes.
 */
function checked(where: string, attribute: string, override: unknown): SpecOverride | false {
  if (override === false) return false;
  if (isAttributeType(override)) return { type: override };
  if (!isSpecOverride(override)) {
    throw new InvalidModel(
      `${where}.${attribute}: an override is a type name, { ${overridableKeyNames} }, or false`,
    );
  }
  return override;
}

/**
 * A generated spec with an override applied, refused if it leaves a spec a type can't have (#99,
 * #73). The merged spec's type isn't known statically, so it's checked here, as a Model's is.
 */
function checkedOverride(
  where: string,
  spec: AttributeSpecs[string],
  change: SpecOverride,
): AttributeSpecs[string] {
  const changed = applyOverride(typeof spec === "string" ? { type: spec } : spec, change);
  const problem = specProblem(where, changed);
  if (problem !== undefined) throw new InvalidModel(problem);
  return changed as AttributeSpecs[string];
}

/** A table's attribute specs with `overrides` applied; throws `InvalidModel` for a bad one. */
function specsFor(
  name: string,
  table: TableSchema,
  overrides: Readonly<Record<string, unknown>>,
): { specs: AttributeSpecs; ignoresColumns: boolean } {
  const changes = new Map<string, ReturnType<typeof checked>>();
  for (const [attribute, override] of Object.entries(overrides)) {
    if (override === undefined) continue;
    if (!Object.hasOwn(table.attributes, attribute)) {
      throw new InvalidModel(`${name} has no attribute ${attribute} to override`);
    }
    if (override === false && attribute === table.primaryKey) {
      throw new InvalidModel(`${name}.${attribute} is the primary key, so it can't be ignored`);
    }
    changes.set(attribute, checked(name, attribute, override));
  }
  const specs: AttributeSpecs = {};
  for (const [attribute, spec] of Object.entries(table.attributes)) {
    const change = changes.get(attribute);
    if (change === false) continue;
    specs[attribute] =
      change === undefined ? spec : checkedOverride(`${name}.${attribute}`, spec, change);
  }
  return { specs, ignoresColumns: [...changes.values()].includes(false) };
}
