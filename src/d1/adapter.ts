// The D1 adapter: what the core needs from D1 besides sending statements.
import type { Adapter } from "../adapter.ts";
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
