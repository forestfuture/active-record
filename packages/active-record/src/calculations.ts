// Reading values instead of records: `count`, `pluck`, `pick`, `ids`, and the calculations `sum`, `average`, `minimum` and `maximum` (#344).
import { attributeFor, withArticle } from "./attribute.ts";
import { attributeOf, type AttributeDefinition, type AttributeType } from "./metadata.ts";
import { compileCalculation, compileCount, compileSelect, type Calculation } from "./compiler.ts";
import type { Dialect } from "./dialect.ts";
import type { QueryRunner } from "./load.ts";
import type { CustomType } from "./custom-types.ts";
import type { EnumValues } from "./enum-values.ts";
import type { AttributesOf, Model, SpecsOf } from "./model.ts";
import type { QueryDescription } from "./query.ts";
import { checkFragment } from "./relation-checks.ts";
import { atMostOne } from "./finder-order.ts";
import { SafeSql } from "./sql.ts";

/** Two or more of a Model's attributes, as `pluck` and `pick` take them for tuples. */
export type AttributeList<M extends Model> = readonly [
  keyof AttributesOf<M> & string,
  keyof AttributesOf<M> & string,
  ...(keyof AttributesOf<M> & string)[],
];

/**
 * What `count`, `pluck` and the calculations read values from: a Relation's query, its database,
 * and its loaded records.
 */
export interface ValueSource {
  readonly query: QueryDescription;
  /** Its database's SQL, read only when a query is compiled: `none()` needs no database. */
  readonly dialect: () => Dialect;
  readonly runner: QueryRunner<Model>;
  /** An association's loaded records, which `pluck` reads without a query. */
  readonly cached: () => readonly Model[] | undefined;
}

/** The number of rows the query returns, or of their non-null values of `attribute`. */
export async function count(
  { query, dialect, runner }: ValueSource,
  attribute?: string,
): Promise<number> {
  if (attribute !== undefined) attributeFor(query.model, attribute); // on none() too
  const [row] = await runner.rows(() => compileCount(dialect(), query, attribute));
  return Number(row?.["count"] ?? 0);
}

/** Converted values of one attribute, or tuples of several, in the query's order. */
export async function pluck(
  { query, dialect, runner, cached }: ValueSource,
  attributes: readonly string[],
  method = "pluck",
): Promise<unknown[]> {
  if (attributes.length === 0) throw new TypeError(`${method}() needs at least one attribute`);
  const resolved = attributes.map((name) => attributeFor(query.model, name));
  const loaded = cached();
  const values =
    loaded === undefined
      ? (await runner.rows(() => compileSelect(dialect(), query, { attributes }))).map((row) =>
          resolved.map((attribute) => attribute.read(row[attribute.column])),
        )
      : loaded.map((record) =>
          // Copies, as a query would give, never the records' own objects.
          resolved.map((attribute) => attribute.copy(Reflect.get(record, attribute.name))),
        );
  return attributes.length === 1 ? values.map(([value]) => value) : values;
}

/**
 * What `pluck` reads from the first row in the query's order (`LIMIT 1`, keeping its offset), or
 * null with none: a loaded association's first record answers without a query.
 */
export async function pick(source: ValueSource, attributes: readonly string[]): Promise<unknown> {
  const query = { ...source.query, limit: atMostOne(source.query.limit) };
  const cached = () => source.cached()?.slice(0, 1);
  const [first] = await pluck({ ...source, query, cached }, attributes, "pick");
  return first ?? null;
}

/**
 * The primary keys, as `pluck` reads them, but none of a built record that has no key yet: a
 * loaded association's unsaved records come after its stored ones.
 */
export async function ids(source: ValueSource): Promise<(string | number)[]> {
  const keys = await pluck(source, [source.query.model.primaryKey], "ids");
  return keys.filter((key): key is string | number => key !== null);
}

/**
 * A calculation over the rows the query returns, of an attribute or an `sql` fragment. Of an
 * attribute, a sum (0 with no rows), a minimum or a maximum reads as the attribute's value; of a
 * fragment, a sum is a number, and a minimum or maximum the value the database returned. An
 * average is a number. With no rows, all but a sum are `null`.
 */
export async function runCalculation(
  { query, dialect, runner }: ValueSource,
  calculation: Calculation,
  operand: string | SafeSql,
): Promise<unknown> {
  const read = calculationReader(query, calculation, operand);
  const [row] = await runner.rows(() => compileCalculation(dialect(), query, calculation, operand));
  return read(row?.["value"] ?? (calculation === "sum" ? 0 : null));
}

/**
 * How a calculation's result reads, as `runCalculation` describes; an unknown attribute, or one
 * the calculation can't take, throws first.
 */
export function calculationReader(
  query: QueryDescription,
  calculation: Calculation,
  operand: string | SafeSql,
): (cell: unknown) => unknown {
  const read =
    operand instanceof SafeSql
      ? readUntyped(query, calculation, operand)
      : readAs(query, calculation, operand);
  return (cell) => {
    if (cell === null) return null;
    return calculation === "average" ? Number(cell) : read(cell);
  };
}

/** How a fragment's result reads: a sum as a number, an extreme as it is; checked first. */
function readUntyped(
  query: QueryDescription,
  calculation: Calculation,
  fragment: SafeSql,
): ResultReader {
  checkFragment(query.model, fragment);
  return (cell) => (calculation === "sum" ? Number(cell) : cell);
}

/**
 * How an attribute's result reads: as its value. An unknown attribute throws first, and so does
 * one the calculation can't take.
 */
function readAs(
  query: QueryDescription,
  calculation: Calculation,
  attribute: string,
): ResultReader {
  const resolved = attributeFor(query.model, attribute);
  const definition = attributeOf(query.model, attribute);
  if (calculation === "sum" || calculation === "average") {
    requireNumber(definition, attribute, calculation);
  } else {
    requireOrdered(definition, attribute, calculation);
  }
  // A decimal reads its text; an integer's sum on Postgres needs its number (a custom type's too).
  const isNumber = definition.type === "integer" || definition.type === "real";
  return (cell) => resolved.read(isNumber ? numberCell(cell) : cell);
}

/** The types a sum or an average takes; a custom type stored as one of them too. */
const numberTypes = ["integer", "real", "decimal"] as const satisfies readonly AttributeType[];

/** The types with no minimum or maximum: Postgres has none of a boolean, json or bytes. */
const unorderedTypes = ["boolean", "json", "binary"] as const satisfies readonly AttributeType[];

/** Whether `type` is one of `types`. */
function isOneOf(types: readonly AttributeType[], type: AttributeType): boolean {
  return types.includes(type);
}

/** Only numbers add up: not text, which SQLite would coerce and Postgres refuse, nor an enum. */
function requireNumber(definition: AttributeDefinition, name: string, method: Calculation): void {
  if (definition.enum === undefined && isOneOf(numberTypes, definition.type)) return;
  const kind =
    definition.enum === undefined ? `${withArticle(definition.type)} attribute` : "an enum";
  throw new TypeError(`${method}() needs a number attribute: "${name}" is ${kind}`);
}

/** Only ordered values have extremes. */
function requireOrdered(definition: AttributeDefinition, name: string, method: Calculation): void {
  if (!isOneOf(unorderedTypes, definition.type)) return;
  throw new TypeError(
    `${method}() can't compare "${name}", ${withArticle(definition.type)} attribute`,
  );
}

/** An operation `calculate` runs: a count, or a calculation of an attribute's values. */
export type Operation = "count" | Calculation;

const operations: readonly Operation[] = ["count", "sum", "average", "minimum", "maximum"];

/** `operation`, if `calculate` runs it, or `TypeError`. */
export function requireOperation(operation: unknown): Operation {
  if (operations.includes(operation as Operation)) return operation as Operation;
  const names = operations.map((name) => `"${name}"`);
  throw new TypeError(
    `calculate() takes ${names.slice(0, -1).join(", ")} or ${names.at(-1)}, not ${JSON.stringify(operation)}`,
  );
}

/** The built-in type a spec is stored as: its type, or its custom type's `storedAs`. */
export type StoredTypeOf<S> = (S extends { type: infer T } ? T : S) extends infer T
  ? T extends CustomType<unknown, infer B>
    ? B
    : T
  : never;

/**
 * The attributes of record type `M` a sum or an average takes: those stored as integers, reals
 * or decimals, a custom type's too, but not an enum's.
 */
export type NumberAttribute<M> = {
  [K in keyof SpecsOf<M>]: SpecsOf<M>[K] extends { enum: EnumValues }
    ? never
    : StoredTypeOf<SpecsOf<M>[K]> extends (typeof numberTypes)[number]
      ? K
      : never;
}[keyof SpecsOf<M>] &
  keyof AttributesOf<M> &
  string;

/** The attributes of record type `M` with a minimum and maximum: not booleans, json or bytes. */
export type OrderedAttribute<M> = {
  [K in keyof SpecsOf<M>]: StoredTypeOf<SpecsOf<M>[K]> extends (typeof unorderedTypes)[number]
    ? never
    : K;
}[keyof SpecsOf<M>] &
  keyof AttributesOf<M> &
  string;

/**
 * What a calculation of `K` resolves to besides `null`: an attribute's value, or for an `sql`
 * fragment, `Fragment` (a sum's number, or an extreme's `unknown` cell).
 */
export type CalculatedValue<M, K, Fragment = number> = K extends SafeSql
  ? Fragment
  : NonNullable<AttributesOf<M>[K & keyof AttributesOf<M>]>;

/** Reads a calculation's result, which isn't null. */
type ResultReader = (cell: unknown) => unknown;

/**
 * A number's cell: Postgres sums a `bigint` as `numeric`, which reads as text, so a whole
 * number's text is its number here, and refused past a safe integer as any integer cell is.
 */
function numberCell(cell: unknown): unknown {
  return typeof cell === "string" ? Number(cell) : cell;
}
