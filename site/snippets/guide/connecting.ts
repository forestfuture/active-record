import { withDatabase } from "@forestfuture/active-record";
import {
  connect,
  withSession,
  type Database,
  type QueryListener,
} from "@forestfuture/active-record/d1";
import { User } from "../getting-started/models";

async function handle(_request: Request): Promise<Response> {
  const user = await User.createOrThrow({ email: "jane@example.com" });
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

export function several(env: Env, handle: () => Promise<Response>) {
  // #region several
  const onQuery: QueryListener = ({ sql }) => console.log(sql);
  const databases: Database[] = [connect(env.DB, { onQuery }), connect(env.LOGS, { onQuery })];
  return withDatabase(databases, handle); // each Model uses the one on its binding
  // #endregion several
}
