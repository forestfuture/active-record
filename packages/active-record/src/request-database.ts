// Outside a Worker, where no binding can be read, the database a Model's statics use: the only one `withDatabase` was given.
import type { AnyDatabase } from "./database.ts";
import { NoDatabase } from "./errors.ts";

/**
 * The request's database for a query on `binding` outside a Worker, or a `NoDatabase` saying what
 * to do. `connect` is how the adapter's docs open one, such as `connect(env.DB)`.
 */
export function onlyRequested(
  requested: readonly AnyDatabase[],
  binding: string | undefined,
  connect: string,
): AnyDatabase {
  if (requested.length === 1) return requested[0]!;
  const reason =
    requested.length > 1
      ? "withDatabase was given several, and outside a Worker a binding can't tell which"
      : binding === undefined
        ? "its Model's base class holds no generated schema, which names its binding"
        : `the binding ${binding} is only there inside a Worker`;
  throw new NoDatabase(
    `No database for this query: ${reason}. Wrap the code in withDatabase(${connect}, …), ` +
      "or use db.model(Model)",
  );
}
