// What the core needs from a kind of database besides sending statements: its SQL, and reading its errors.
import type { AnyDatabase } from "./database.ts";
import type { Dialect } from "./dialect.ts";

/** What a database's error says about a constraint that failed. */
export interface ConstraintFailure {
  kind: "unique" | "notNull" | "foreignKey" | "check";
  /** The table the error names, if it names one. */
  table: string | undefined;
  /** The columns the error names, if any. */
  columns: string[];
}

/** One kind of database (ADR-0016). A `Driver` sends to one database of that kind. */
export interface Adapter {
  /** What the database is called in messages. */
  readonly name: string;
  readonly dialect: Dialect;
  /** The most values one statement can bind. */
  readonly maxBoundValues: number;
  /** What `error` says failed, or undefined when it isn't a constraint failure. */
  constraintFailure(error: unknown): ConstraintFailure | undefined;
  /** The table `error` says doesn't exist, or undefined when it says something else. */
  missingTable(error: unknown): string | undefined;
  /** The error to throw when `error` means the query couldn't run here at all, or undefined. */
  refusal(error: unknown): Error | undefined;
  /**
   * The database a query from a Model's statics uses now: one of the request's, `requested`, or
   * this adapter's own for `binding`, the name in the Model's schema. A Model with no schema has
   * none. Throws `NoDatabase` when there isn't one.
   */
  databaseFor(binding: string | undefined, requested: readonly AnyDatabase[]): Promise<AnyDatabase>;
}
