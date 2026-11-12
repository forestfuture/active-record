import { belongsTo, hasMany, Model } from "@forestfuture/active-record";
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

// #region associations
export class User extends DbRecord {
  entries = hasMany(Entry); // on LOGS
}

export class Entry extends LogsRecord {
  user = belongsTo(User, { optional: true }); // on DB; an entry may have no user
}
// #endregion associations

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

// #region reading-associations
export async function errorEntriesOf(userId: number) {
  const user = await User.find(userId); // on DB
  return user.entries().where({ level: "error" }).toArray(); // on LOGS
}

export async function entriesWithUsers() {
  return Entry.includes("user").toArray(); // the entries on LOGS, then their users on DB
}
// #endregion reading-associations

// #region creating-through
export async function logFor(user: User, message: string) {
  return user.entries().create({ level: "info", message }); // on LOGS, with the user's key
}
// #endregion creating-through

// #region autosaving
export async function signUpWithEntry(email: string) {
  const user = User.build({ email });
  user.entries().build({ level: "info", message: "signed up" });
  await user.saveOrThrow(); // the user on DB, then the entry on LOGS
  return user;
}
// #endregion autosaving

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
