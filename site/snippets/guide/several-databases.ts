import { Model } from "@forestfuture/active-record";
import { withSession } from "@forestfuture/active-record/d1";
import { schema as logsSchema } from "../db/logs";
import { schema as dbSchema } from "../db/schema";

// Each binding's base class, holding the schema `active-record schema` writes for it
// (site/snippets/db/schema.ts and logs.ts).
abstract class DbRecord extends Model {
  static override schema = dbSchema;
}
abstract class LogsRecord extends Model {
  static override schema = logsSchema;
}

export class User extends DbRecord {}
export class Entry extends LogsRecord {}

// #region request
// src/worker.ts: each Model queries its own database.
export default {
  async fetch(request) {
    const email = new URL(request.url).searchParams.get("email") ?? "";
    const user = await User.findByOrThrow({ email }); // on DB
    await Entry.create({ level: "info", message: `${user.email} signed in` }); // on LOGS
    return Response.json(user);
  },
} satisfies ExportedHandler<Env>;
// #endregion request

// #region sign-up
export async function signUp(email: string) {
  const user = await User.createOrThrow({ email }); // on DB first: if it throws, nothing is logged
  await Entry.create({ level: "info", message: `${user.email} signed up` }); // then on LOGS
  return user;
}
// #endregion sign-up

async function handle(request: Request): Promise<Response> {
  return Response.json(await signUp(new URL(request.url).searchParams.get("email") ?? ""));
}

// #region sessions
// src/worker.ts: each database's bookmark travels in its own cookie.
export const replicas = {
  fetch: (request, env) =>
    withSession(request, env.DB, () =>
      withSession(request, env.LOGS, { cookie: "logs-bookmark" }, () => handle(request)),
    ),
} satisfies ExportedHandler<Env>;
// #endregion sessions
