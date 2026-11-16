// Reading values instead of records: `count`, `pluck`, and the calculations `sum`, `average`, `minimum` and `maximum` (#344).
import { attributeFor } from "./attribute.ts";
import { attributeOf } from "./metadata.ts";
import {
  compileCalculation,
  compileColumns,
  compileCount,
  compileSelect,
  type Calculation,
} from "./compiler.ts";
import type { Dialect } from "./dialect.ts";
import type { QueryRunner } from "./load.ts";
import type { AttributesOf, Model } from "./model.ts";
import type { QueryDescription } from "./query.ts";
import { checkFragment } from "./relation-checks.ts";
import { SafeSql } from "./sql.ts";

/** What a calculation or `pluck` reads: a Relation's query, its database, and its loaded records. */
export interface CalculationContext {
  readonly query: QueryDescription;
  /** Its database's SQL, read only when a query is compiled: `none()` needs no database. */
  readonly dialect: () => Dialect;
  readonly runner: QueryRunner<Model>;
  /** An association's loaded records, which `pluck` reads without a query. */
  readonly cached: () => readonly Model[] | undefined;
}

/** The number of rows the query returns, or of their non-null values of `attribute`. */
export async function count(
  { query, dialect, runner }: CalculationContext,
  attribute?: string,
): Promise<number> {
  if (attribute !== undefined) attributeFor(query.model, attribute); // on none() too
  const [row] = await runner.rows(() => compileCount(dialect(), query, attribute));
  return Number(row?.["count"] ?? 0);
}

/** Converted values of one attribute, or tuples of several, in the query's order. */
export async function pluck(
  { query, dialect, runner, cached }: CalculationContext,
  attributes: readonly string[],
): Promise<unknown[]> {
  if (attributes.length === 0) throw new TypeError("pluck() needs at least one attribute");
  const resolved = attributes.map((name) => attributeFor(query.model, name));
  const loaded = cached();
  const values =
    loaded === undefined
      ? (
          await runner.rows(() =>
            compileSelect(dialect(), query, compileColumns(query.model, attributes)),
          )
        ).map((row) => resolved.map((attribute) => attribute.read(row[attribute.column])))
      : loaded.map((record) =>
          // Copies, as a query would give, never the records' own objects.
          resolved.map((attribute) => attribute.copy(Reflect.get(record, attribute.name))),
        );
  return attributes.length === 1 ? values.map(([value]) => value) : values;
}

/**
 * A calculation over the rows the query returns, of an attribute or an `sql` fragment. Of an
 * attribute, a sum (0 with no rows), a minimum or a maximum reads as the attribute's value; of a
 * fragment, a sum is a number, and a minimum or maximum the value the database returned. An
 * average is a number. With no rows, all but a sum are `null`.
 */
export async function calculate(
  { query, dialect, runner }: CalculationContext,
  calculation: Calculation,
  of: string | SafeSql,
): Promise<unknown> {
  const read = of instanceof SafeSql ? readUntyped(query, of) : readAs(query, of);
  const [row] = await runner.rows(() => compileCalculation(dialect(), query, calculation, of));
  const cell = row?.["value"] ?? (calculation === "sum" ? 0 : null);
  if (cell === null) return null;
  return calculation === "average" ? Number(cell) : read(calculation, cell);
}

/** How a fragment's result reads: a sum as a number, an extreme as it is; checked first. */
function readUntyped(query: QueryDescription, fragment: SafeSql): ResultReader {
  checkFragment(query.model, fragment);
  return (calculation, cell) => (calculation === "sum" ? Number(cell) : cell);
}

/** How an attribute's result reads: as its value. An unknown attribute throws first. */
function readAs(query: QueryDescription, attribute: string): ResultReader {
  const resolved = attributeFor(query.model, attribute);
  const isNumber = ["integer", "real"].includes(attributeOf(query.model, attribute).type);
  return (_calculation, cell) => resolved.read(isNumber ? numberCell(cell) : cell);
}

/**
 * What a calculation of `K` resolves to besides `null`: an attribute's value, or for an `sql`
 * fragment, `Fragment` (a sum's number, or an extreme's `unknown` cell).
 */
export type CalculatedValue<M, K, Fragment = number> = K extends SafeSql
  ? Fragment
  : NonNullable<AttributesOf<M>[K & keyof AttributesOf<M>]>;

/** Reads a calculation's result, which isn't null. */
type ResultReader = (calculation: Calculation, cell: unknown) => unknown;

/**
 * A number's cell: Postgres sums a `bigint` as `numeric`, which reads as text, so a whole
 * number's text is its number here, and refused past a safe integer as any integer cell is.
 */
function numberCell(cell: unknown): unknown {
  return typeof cell === "string" ? Number(cell) : cell;
}
