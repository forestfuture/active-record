// The PostgreSQL adapter: what the core needs from Postgres besides sending statements.
import type { Adapter, SchemaAdapter } from "@forestfuture/active-record/adapter";
import { databaseFor } from "./current-database.ts";
import { postgres } from "./dialect.ts";
import { constraintFailure, missingTable } from "./errors.ts";

export const pgAdapter: Adapter = {
  name: "Postgres",
  dialect: postgres,
  // The protocol counts a statement's bound values in 16 bits.
  maxBoundValues: 65_535,
  constraintFailure,
  missingTable,
  refusal: () => undefined,
  databaseFor,
};

/** The Postgres database a generated schema's Models query: `adapter: postgresql({ binding: "HYPERDRIVE" })`. */
export function postgresql({ binding }: { binding: string }): SchemaAdapter {
  return { adapter: pgAdapter, binding };
}
