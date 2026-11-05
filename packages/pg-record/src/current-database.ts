// Which Postgres database a query from a Model's statics uses: the request's, from `withDatabase`.
import type { AnyDatabase } from "@forestfuture/active-record/adapter";
import { NoDatabase } from "@forestfuture/active-record";

/** Why there's no database here, saying what to do. */
function noDatabase(reason: string): NoDatabase {
  return new NoDatabase(
    `No database for this query: ${reason}. Wrap the code in withDatabase(connect(…), …), ` +
      "or use db.model(Model)",
  );
}

/** The database a query on binding `name` uses now: the request's. */
export async function databaseFor(
  name: string | undefined,
  requested: readonly AnyDatabase[],
): Promise<AnyDatabase> {
  if (requested.length === 1) return requested[0]!;
  if (requested.length > 1) {
    throw noDatabase("withDatabase was given several, and a binding can't tell which");
  }
  throw noDatabase(
    name === undefined
      ? "its Model's base class holds no generated schema, which names its binding"
      : `the binding ${name} needs withDatabase`,
  );
}
