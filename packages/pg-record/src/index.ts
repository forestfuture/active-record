// The Postgres adapter's public API: what an app imports from `@forestfuture/pg-record`, beside the core.
export { pg } from "./adapter.ts";
export type { Pool, PoolClient, QueryConfig, QueryResult, TypeParsers } from "./clients.ts";
export {
  connect,
  Database,
  type ConnectOptions,
  type PgSource,
  type QueryEvent,
  type QueryListener,
} from "./database.ts";
export type { PgMeta } from "./driver.ts";
