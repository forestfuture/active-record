// pg-record in workerd, for tests/integration/pg/workerd.test.ts: each route reports the backend
// (connection) each query ran on, so the test sees which client served it.
import { Model, withDatabase } from "../../../../packages/active-record/src/index.ts";
import { connect, pg } from "../../../../packages/pg-record/src/index.ts";

interface Env {
  DATABASE_URL: string;
}

abstract class PgRecord extends Model {
  static override schema = { adapter: pg({ binding: "DATABASE_URL" }), tables: {} };
}

class Backend extends PgRecord.define({ id: { type: "integer", null: false } }) {
  static override table = "backends";
}

class User extends PgRecord.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static override table = "users";
}

const backend = async () => (await Backend.pluck("id"))[0];

const routes: Record<string, (env: Env) => Promise<unknown>> = {
  /** A Model's statics, with no withDatabase: the binding's own database, a client per query. */
  async "/statics"() {
    const made = await User.create({ email: "worker@example.com" });
    const found = await User.find(made.id);
    return { email: found.email, backends: [await backend(), await backend()] };
  },
  /** A request's database from the connection string: one client for the scope. */
  async "/scope"(env) {
    const backends = await withDatabase(connect(env.DATABASE_URL), async () => [
      await backend(),
      await backend(),
    ]);
    return { backends };
  },
  /** The same from a Hyperdrive binding's shape: what pg-record reads of one. */
  async "/hyperdrive"(env) {
    const hyperdrive = { connectionString: env.DATABASE_URL } as Parameters<typeof connect>[0];
    const backends = await withDatabase(connect(hyperdrive), async () => [
      await backend(),
      await backend(),
    ]);
    return { backends };
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
