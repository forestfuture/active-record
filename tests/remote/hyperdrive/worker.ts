// pg-record through a real Hyperdrive, deployed for a moment by tests/remote/hyperdrive.test.ts: each
// route reports what it saw, on this run's prefixed tables (TABLE_PREFIX).
import { Model, withDatabase } from "../../../packages/active-record/src/index.ts";
import { connect, pg } from "../../../packages/pg-record/src/index.ts";

interface Env {
  HYPERDRIVE: Parameters<typeof connect>[0];
  TABLE_PREFIX: string;
}

abstract class SmokeRecord extends Model {
  static override schema = { adapter: pg({ binding: "HYPERDRIVE" }), tables: {} };
}

/** The run's Models, on its own tables. */
function modelsFor(prefix: string) {
  class User extends SmokeRecord.define({
    id: { type: "integer", null: false },
    email: { type: "string", null: false },
    role: "string",
  }) {
    static override table = `${prefix}users`;
  }
  return { User };
}

const routes: Record<string, (env: Env) => Promise<unknown>> = {
  /** A Model's statics, with no withDatabase: the binding's own database. */
  async "/statics"(env) {
    const { User } = modelsFor(env.TABLE_PREFIX);
    const made = await User.create({ email: "statics@example.com" });
    return { email: (await User.find(made.id)).email };
  },
  /** A request's database, one client for its scope, and a page read in order on it. */
  async "/scope"(env) {
    const { User } = modelsFor(env.TABLE_PREFIX);
    return withDatabase(connect(env.HYPERDRIVE), async () => {
      await User.insertAll([{ email: "a@example.com" }, { email: "b@example.com" }]);
      const page = await User.order({ email: "asc" }).paginate({ page: 1, perPage: 1 });
      return { emails: page.records.map((user) => user.email), total: page.total };
    });
  },
  /** A write beside a failing batch is kept: the batch has a client, and a transaction, of its own. */
  async "/batch"(env) {
    const { User } = modelsFor(env.TABLE_PREFIX);
    const db = connect(env.HYPERDRIVE);
    const users = db.model(User);
    return withDatabase(db, async () => {
      const failed = db
        .batch([
          users.toInsert({ email: "in-batch@example.com" }),
          users.where({ email: "nobody@example.com" }).toUpdateAll({ role: "x" }),
          users.toInsert({ email: "in-batch@example.com" }),
        ])
        .then(
          () => "written",
          (error: unknown) => (error as Error).name,
        );
      await users.create({ email: "beside@example.com" });
      return {
        batch: await failed,
        emails: await users
          .where({ email: ["in-batch@example.com", "beside@example.com"] })
          .pluck("email"),
      };
    });
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const route = routes[new URL(request.url).pathname];
    if (route === undefined) return new Response("not found", { status: 404 });
    try {
      return Response.json(await route(env));
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
