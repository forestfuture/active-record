import { Model, type QueryListener } from "@forestfuture/active-record";
import { env } from "cloudflare:workers";
import { schema } from "./src/db/schema";

// #region app-wide-development
// src/models/application-record.ts: logs only when LOG_SQL is set (in .dev.vars), read when a query runs.
export abstract class ApplicationRecord extends Model {
  static override schema = schema;

  static override onQuery: QueryListener = ({ model, sql, durationMs }) => {
    if ((env as { LOG_SQL?: string }).LOG_SQL) {
      console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`);
    }
  };
}
// #endregion app-wide-development
