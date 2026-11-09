// The PostgreSQL adapter's public API: what an app imports from `@forestfuture/active-record/postgresql`, beside the core.
export { postgresql } from "./adapter.ts";
export type { Pool } from "./clients.ts";
export {
  connect,
  Database,
  type ConnectOptions,
  type PostgreSQLSource,
  type QueryEvent,
  type QueryListener,
} from "./database.ts";
export type { PostgreSQLMeta } from "./driver.ts";
