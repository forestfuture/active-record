// Statement: a bulk write (`toInsert`, `toUpdateAll`, …) built to run on its own or in a batch, and what runs once it's written.
import {
  compileInsert,
  compileInsertRows,
  type Assignment,
  type CompiledSql,
  querySql,
  type Conflict,
  type QuerySql,
} from "./compiler.ts";
import type { Executor } from "./executor.ts";
import { attributeOf, initialValues, requireDefined } from "./metadata.ts";
import type { ModelClass } from "./model.ts";
import { timestampsFor } from "./timestamps.ts";

/** @internal The library's key for what `db.batch` needs from a Statement. */
export const statementParts = Symbol("statementParts");

/**
 * A write prepared for `db.batch([...])`, from a Relation's `to…` methods (`toInsert`,
 * `toUpdateAll`, `toDeleteAll`, …). It runs on the Database it was built from, and skips
 * validations, callbacks and hydration. It has no `then`, so it's never run by being awaited.
 */
export class Statement {
  readonly #executor: Executor;
  readonly #query: CompiledSql;
  readonly #landed: () => void;

  /**
   * @internal Statements are built by Relations' `to…` methods. `landed` runs once D1 has
   * written it, alone or in a batch (a hasMany's clears what its owner has loaded, #187).
   */
  constructor(executor: Executor, query: CompiledSql, landed: () => void = () => {}) {
    this.#executor = executor;
    this.#query = query;
    this.#landed = landed;
  }

  /** The SQL this Statement sends and its bound values, unsent: see `Relation#toSql`. */
  toSql(): QuerySql {
    return querySql(this.#query);
  }

  /** @internal The Database's Executor it runs on, its compiled SQL, and what runs once written. */
  get [statementParts](): { executor: Executor; query: CompiledSql; landed: () => void } {
    return { executor: this.#executor, query: this.#query, landed: this.#landed };
  }
}

/** Runs a statement on its own, then its `landed`, resolving to D1's `meta`: what a Relation's write methods do. */
export async function runAlone(statement: Statement): Promise<D1Meta> {
  const { executor, query, landed } = statement[statementParts];
  const meta = await executor.run(query);
  landed();
  return meta;
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
 */
export function insertStatement(
  executor: Executor,
  model: ModelClass,
  rows: readonly Record<string, unknown>[],
  {
    conflict,
    method,
    landed,
  }: { conflict?: Conflict | undefined; method: string; landed?: () => void },
): Statement {
  const given = sameAttributes(rows, method);
  const assigned = rows.map((row) => new Map(insertAssignments(model, row)));
  const names = [...(assigned[0]?.keys() ?? [])];
  if (names.length === 0) {
    if (rows.length === 1 && conflict === undefined) {
      return new Statement(executor, compileInsert(model, []), landed);
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
  });
  return new Statement(executor, compiled, landed);
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
