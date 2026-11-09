// The D1 adapter: what the core needs from D1 besides sending statements.
import type { Adapter, SchemaAdapter } from "@forestfuture/active-record/adapter";
import { databaseFor } from "./current-binding.ts";
import { sqlite } from "./dialect.ts";
import { constraintFailure, missingTable, outsideRequest } from "./errors.ts";

export const d1Adapter: Adapter = {
  name: "D1",
  dialect: sqlite,
  maxBoundValues: 100,
  constraintFailure,
  missingTable,
  refusal: outsideRequest,
  databaseFor,
};

/** The D1 database a generated schema's Models query: `adapter: d1({ binding: "DB" })`. */
export function d1({ binding }: { binding: string }): SchemaAdapter {
  return { adapter: d1Adapter, binding };
}
