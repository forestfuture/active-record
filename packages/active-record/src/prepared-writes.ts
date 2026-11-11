// PreparedWrites: a Relation's bulk writes as Statements, unsent, for a Batch to prepare.
import type { AttributesOf } from "./model.ts";
import type { InsertOptions, Returning, UpsertOptions } from "./relation-checks.ts";
import type { SafeSql } from "./sql.ts";
import type { ReturnedRow, Statement } from "./statement.ts";

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
