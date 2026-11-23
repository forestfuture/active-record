// The Relation methods asking how many records it has: `size`, `isEmpty`, `hasAny`, `hasMoreThanOne`
// and `hasExactlyOne`, between Relation and its token finders so relation.ts stays the chainable
// query's own.
import type { Model } from "./model.ts";
import { isEmpty, size, upToTwo, type CountSource } from "./record-counts.ts";
import { TokenFinders } from "./token-finders.ts";

/** @internal What a Relation's questions about how many records it has read. */
export const countSource = Symbol("countSource");

/** The questions about how many records every Relation has. */
export abstract class CountQuestions<M extends Model> extends TokenFinders<M> {
  /** @internal */
  abstract [countSource](): CountSource;

  /**
   * The number of records: a loaded association's (built records included) without a query;
   * otherwise a `COUNT(*)`, plus an association's unsaved built records.
   */
  async size(): Promise<number> {
    return size(this[countSource]());
  }

  /** Whether there are no records: a loaded association answers itself, else `!exists()`. */
  async isEmpty(): Promise<boolean> {
    return isEmpty(this[countSource]());
  }

  /** Whether there are any records: the opposite of `isEmpty()`. */
  async hasAny(): Promise<boolean> {
    return !(await this.isEmpty());
  }

  /** Whether more than one record matches: one `COUNT` of at most two rows. */
  async hasMoreThanOne(): Promise<boolean> {
    return (await upToTwo(this[countSource]())) > 1;
  }

  /** Whether exactly one record matches: one `COUNT` of at most two rows. */
  async hasExactlyOne(): Promise<boolean> {
    return (await upToTwo(this[countSource]())) === 1;
  }
}
