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
import type { Model } from "./model.ts";
import type { QueryDescription } from "./query.ts";

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

/** A calculation of `attribute` over the rows the query returns, read as the attribute's value. */
export async function calculate(
  { query, dialect, runner }: CalculationContext,
  calculation: Calculation,
  attribute: string,
): Promise<unknown> {
  const resolved = attributeFor(query.model, attribute);
  const [row] = await runner.rows(() =>
    compileCalculation(dialect(), query, calculation, attribute),
  );
  const cell = row?.["value"] ?? 0;
  return resolved.read(isNumber(query, attribute) ? numberCell(cell) : cell);
}

/** Whether `attribute` is stored as an integer or a real (a custom type's too). */
function isNumber(query: QueryDescription, attribute: string): boolean {
  const { type } = attributeOf(query.model, attribute);
  return type === "integer" || type === "real";
}

/**
 * A number's cell: Postgres sums a `bigint` as `numeric`, which reads as text, so a whole
 * number's text is its number here, and refused past a safe integer as any integer cell is.
 */
function numberCell(cell: unknown): unknown {
  return typeof cell === "string" ? Number(cell) : cell;
}
