// PreparedWrites: a Relation's bulk writes as Statements, unsent, for a Batch to prepare, and building them.
import { compileDeleteAll, compileUpdateAll, type Conflict } from "./compiler.ts";
import type { AttributesOf, Model } from "./model.ts";
import { newRowValues, requireSavedOwner, type RelationState } from "./relation-state.ts";
import {
  checkChanges,
  returnedNames,
  skipOn,
  updateOn,
  writableQuery,
  type InsertOptions,
  type Returning,
  type UpsertOptions,
} from "./relation-checks.ts";
import type { SafeSql } from "./sql.ts";
import { insertStatement, Statement, type ReturnedRow } from "./statement.ts";

/** @internal The library's key for a Relation's bulk writes, as Statements. */
export const preparedWrites = Symbol("preparedWrites");

/**
 * @internal Each of a Relation's bulk writes as a Statement, built and checked but unsent: what
 * a Batch's methods return, and what the Relation's own methods run at once.
 */
export interface PreparedWrites<M> {
  insert<const R extends Returning<M> | undefined = undefined>(
    attributes: Partial<AttributesOf<M>>,
    options?: InsertOptions<M> & { returning?: R },
  ): Statement<ReturnedRow<M, R>>;
  insertAll<const R extends Returning<M> | undefined = undefined>(
    rows: readonly Partial<AttributesOf<M>>[],
    options?: InsertOptions<M> & { returning?: R },
  ): Statement<ReturnedRow<M, R>>;
  upsert<const R extends Returning<M> | undefined = undefined>(
    attributes: Partial<AttributesOf<M>>,
    options?: UpsertOptions<M> & { returning?: R },
  ): Statement<ReturnedRow<M, R>>;
  upsertAll<const R extends Returning<M> | undefined = undefined>(
    rows: readonly Partial<AttributesOf<M>>[],
    options?: UpsertOptions<M> & { returning?: R },
  ): Statement<ReturnedRow<M, R>>;
  updateAll(changes: Partial<AttributesOf<M>> | SafeSql): Statement;
  deleteAll(): Statement;
}

/** @internal `relation`'s bulk writes, each built as a Statement when called. */
export function preparedWritesOf<M extends Model>(relation: RelationState<M>): PreparedWrites<M> {
  const { model } = relation;
  return {
    insert: (attributes, options = {}) =>
      insertRows(relation, [attributes], skipOn(options, "insert"), {
        method: "insert",
        returning: options.returning,
      }),
    insertAll: (rows, options = {}) =>
      insertRows(relation, rows, skipOn(options, "insertAll"), {
        method: "insertAll",
        returning: options.returning,
      }),
    upsert: (attributes, options = {}) =>
      insertRows(relation, [attributes], updateOn(model, options), {
        method: "upsert",
        returning: options.returning,
      }),
    upsertAll: (rows, options = {}) =>
      insertRows(relation, rows, updateOn(model, options), {
        method: "upsertAll",
        returning: options.returning,
      }),
    updateAll: (changes) => updateAllStatement(relation, changes),
    deleteAll: () => deleteAllStatement(relation),
  };
}

function insertRows<Row>(
  relation: RelationState<Model>,
  rows: readonly Readonly<Record<string, unknown>>[],
  conflict: Conflict | undefined,
  { method, returning }: { method: string; returning?: Returning<Model> | undefined },
): Statement<Row> {
  requireSavedOwner(relation, "insert");
  const values = rows.map((row) => newRowValues(relation, row));
  return insertStatement(relation.executor, relation.model, values, {
    conflict,
    method,
    landed: clearCollectionUntilWritten(relation),
    returning: returnedNames(relation.model, returning),
  });
}

function updateAllStatement<M extends Model>(
  relation: RelationState<M>,
  changes: Partial<AttributesOf<M>> | SafeSql,
): Statement {
  const { executor, model, query } = relation;
  const checked = checkChanges(model, changes);
  const compiled = compileUpdateAll(executor.dialect, writableQuery(query, "updateAll"), checked);
  return new Statement(executor, [compiled], clearCollectionUntilWritten(relation));
}

function deleteAllStatement(relation: RelationState<Model>): Statement {
  const { executor, collection } = relation;
  const query = writableQuery(relation.query, "deleteAll");
  const own = collection.deleteAllOf?.(query);
  if (own !== undefined) return own;
  const landed = clearCollectionUntilWritten(relation);
  const nullifies = collection.nullifies;
  const compiled =
    nullifies === undefined
      ? compileDeleteAll(executor.dialect, query)
      : compileUpdateAll(
          executor.dialect,
          query,
          nullifies.map((each) => [each, null]),
        );
  return new Statement(executor, [compiled], landed);
}

/**
 * @internal Clears what an owner has loaded through `relation`'s hasMany, for a write through
 * it; the function it returns clears it again once the write has landed (#187).
 */
export function clearCollectionUntilWritten({ collection }: RelationState<Model>): () => void {
  collection.invalidate();
  return () => collection.invalidate();
}
