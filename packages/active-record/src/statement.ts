// Statement: a bulk write (`insert`, `updateAll`, …) built to run on its own or in a batch, and what runs once it's written.
import {
  compileInsert,
  compileInsertRows,
  type Assignment,
  type CompiledSql,
  type Conflict,
} from "./compiler.ts";
import type { StatementResult } from "./driver.ts";
import type { Executor } from "./executor.ts";
import { attributeFor } from "./attribute.ts";
import { attributeOf, initialValues, requireDefined } from "./metadata.ts";
import type { AttributesOf, ModelClass } from "./model.ts";
import { timestampsFor } from "./timestamps.ts";

/** @internal The library's key for what `db.batch` needs from a Statement. */
export const statementParts = Symbol("statementParts");

declare const rowType: unique symbol;

/**
 * What a bulk write resolves to, alone or in `db.batch`: how many rows it inserted, updated or
 * deleted, and the attributes an insert or upsert returned of each row it wrote (`returning`,
 * the primary key by default), in no promised order. Other writes return no rows.
 */
export interface WriteResult<Row = Record<string, unknown>> {
  rowsAffected: number;
  rows: Row[];
}

/** Each returned row's type: the attributes `returning` names, any of them when it names none. */
export type ReturnedRow<M, R> = R extends false | readonly []
  ? never
  : R extends readonly (infer K extends keyof AttributesOf<M>)[]
    ? Pick<AttributesOf<M>, K>
    : Partial<AttributesOf<M>>;

/** Reads a write's returned rows as attribute values. */
type RowReader = (rows: readonly Record<string, unknown>[]) => object[];

const noRows: RowReader = () => [];

/**
 * A bulk write prepared in a batch, by a Batch's methods (`b.insert`, `b.updateAll`,
 * `b.deleteAll`, …). It runs on the Database it was built from, and skips validations,
 * callbacks and hydration. It has no `then`, so it's never run by being awaited.
 */
export class Statement<Row = never> {
  declare readonly [rowType]?: Row;
  readonly #executor: Executor;
  readonly #query: CompiledSql;
  readonly #landed: () => void;
  readonly #rows: RowReader;

  /**
   * @internal Statements are built by a Relation's bulk writes. `landed` runs once D1 has
   * written it, alone or in a batch (a hasMany's clears what its owner has loaded, #187), and
   * `rows` reads what it returned.
   */
  constructor(
    executor: Executor,
    query: CompiledSql,
    landed: () => void = () => {},
    rows: RowReader = noRows,
  ) {
    this.#executor = executor;
    this.#query = query;
    this.#landed = landed;
    this.#rows = rows;
  }

  /**
   * @internal The Database's Executor it runs on, its compiled SQL, what runs once written, and
   * its `WriteResult` from what the database returned.
   */
  get [statementParts](): {
    executor: Executor;
    query: CompiledSql;
    landed: () => void;
    resultOf: (result: StatementResult) => WriteResult<Row>;
  } {
    const resultOf = ({ rowsAffected, rows }: StatementResult) => ({
      rowsAffected,
      rows: this.#rows(rows) as Row[],
    });
    return { executor: this.#executor, query: this.#query, landed: this.#landed, resultOf };
  }
}

/** Runs a statement on its own, then its `landed`, resolving to its `WriteResult`: what a Relation's write methods do. */
export async function runAlone<Row>(statement: Statement<Row>): Promise<WriteResult<Row>> {
  const { executor, query, landed, resultOf } = statement[statementParts];
  const result = await executor.run(query);
  landed();
  return resultOf(result);
}

/** Reads the attributes `names` of each returned row, each as its type. */
function rowReader(model: ModelClass, names: readonly string[]): RowReader {
  if (names.length === 0) return noRows;
  const attributes = names.map((name) => attributeFor(model, name));
  return (rows) =>
    rows.map((row) =>
      Object.fromEntries(
        attributes.map((attribute) => [attribute.name, attribute.read(row[attribute.column])]),
      ),
    );
}

/**
 * The attributes an insert statement writes: the given ones, then initial values for the
 * rest (where app-generated keys come from), then `createdAt`/`updatedAt` unless given.
 */
function insertAssignments(model: ModelClass, attributes: Record<string, unknown>): Assignment[] {
  for (const name of Object.keys(attributes)) attributeOf(model, name);
  const values = [...Object.entries(attributes), ...initialValues(model, attributes)];
  for (const [name, value] of values) requireDefined(model, name, value);
  return [...values, ...timestampsFor(model, "insert", values)];
}

/**
 * `INSERT` of `rows` into `model`'s table, as one Statement. Every row must have the same
 * attributes as given, as in Rails; `conflict` skips or updates rows that clash with a unique
 * index. An update sets only the given attributes (and `updatedAt`), never filled-in defaults.
 * It returns the attributes `returning` names of each row written.
 */
export function insertStatement<Row>(
  executor: Executor,
  model: ModelClass,
  rows: readonly Record<string, unknown>[],
  { conflict, method, landed, returning }: InsertPlan,
): Statement<Row> {
  const read = rowReader(model, returning);
  const given = sameAttributes(rows, method);
  const assigned = rows.map((row) => new Map(insertAssignments(model, row)));
  const names = [...(assigned[0]?.keys() ?? [])];
  if (names.length === 0) {
    if (rows.length === 1 && conflict === undefined) {
      return new Statement(executor, compileInsert(model, [], returning), landed, read);
    }
    throw new TypeError(`${method}(): nothing to insert; give each row at least one attribute`);
  }
  const values = assigned.map((row) => names.map((name) => row.get(name)));
  const resolved =
    conflict?.kind === "update"
      ? { ...conflict, update: [...given, ...(names.includes("updatedAt") ? ["updatedAt"] : [])] }
      : conflict;
  const compiled = compileInsertRows(executor.dialect, model, {
    names,
    rows: values,
    conflict: resolved,
    returning,
  });
  return new Statement(executor, compiled, landed, read);
}

/** How an insert statement writes: what a conflict does, its method's name, and what it returns. */
interface InsertPlan {
  conflict?: Conflict | undefined;
  method: string;
  landed?: () => void;
  returning: readonly string[];
}

/** The attributes every row was given; they must be the same for all rows, in any order. */
function sameAttributes(rows: readonly Record<string, unknown>[], method: string): string[] {
  const [first, ...rest] = rows.map((row) => Object.keys(row));
  if (first === undefined) throw new TypeError(`${method}() needs at least one row`);
  for (const [index, keys] of rest.entries()) {
    if (keys.length !== first.length || !first.every((name) => keys.includes(name))) {
      throw new TypeError(
        `${method}() rows must all have the same attributes: row ${index + 2} differs from the first (${first.join(", ")})`,
      );
    }
  }
  return first;
}
