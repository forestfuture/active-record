import { Model, withDatabase } from "@forestfuture/active-record";
import {
  connect,
  withSession,
  type Database,
  type QueryListener,
} from "@forestfuture/active-record/d1";
import { env as workerEnv } from "cloudflare:workers";
import { schema } from "../db/schema";
import { User } from "../getting-started/models";

async function handle(_request: Request): Promise<Response> {
  const user = await User.createOrThrow({ email: "ada@example.com" });
  return Response.json(await User.find(user.id)); // reads its own write
}

// #region session
// src/worker.ts: each request reads at least as new as this browser's last write, from any replica.
export default {
  fetch: (request, env) => withSession(request, env.DB, () => handle(request)),
} satisfies ExportedHandler<Env>;
// #endregion session

// #region session-header
// An API's clients send back the x-d1-bookmark header of the response before.
export const api = {
  fetch: (request, env) =>
    withSession(request, env.DB, { header: "x-d1-bookmark" }, () => handle(request)),
} satisfies ExportedHandler<Env>;
// #endregion session-header

// #region app-wide-development
// src/models/application-record.ts: logs only when LOG_SQL is set (in .dev.vars), read when a query runs.
export abstract class ApplicationRecord extends Model {
  static override schema = schema;

  static override onQuery: QueryListener = ({ model, sql, durationMs }) => {
    if ((workerEnv as { LOG_SQL?: string }).LOG_SQL) {
      console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`);
    }
  };
}
// #endregion app-wide-development

export async function inATest(binding: D1Database): Promise<void> {
  // #region test
  // Outside a Worker there's no env.DB to find, so a test names its database.
  await withDatabase(connect(binding), async () => {
    await User.create({ email: "ada@example.com" });
    console.log(await User.count()); // 1
  });
  // #endregion test
}

export function several(env: Env, handle: () => Promise<Response>) {
  // #region several
  const onQuery: QueryListener = ({ sql }) => console.log(sql);
  const databases: Database[] = [connect(env.DB, { onQuery }), connect(env.LOGS, { onQuery })];
  return withDatabase(databases, handle); // each Model uses the one on its binding
  // #endregion several
}
