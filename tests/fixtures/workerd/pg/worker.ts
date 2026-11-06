// pg-record in workerd, for tests/integration/pg/workerd.test.ts: each route reports the backend
// (connection) each query ran on, so the test sees which client served it.
import { Model, sql, withDatabase } from "../../../../packages/active-record/src/index.ts";
import pgModule from "pg";
import { connect, pg, type Database } from "../../../../packages/pg-record/src/index.ts";

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

/** One Database for every request, as an app opens it at module scope. */
let shared: Database | undefined;

/** Long enough for overlapping requests to be inside their scopes at once. */
const pause = () => Backend.where(sql`(SELECT true FROM pg_sleep(0.2))`).pluck("id");

const routes: Record<string, (env: Env, url: URL) => Promise<unknown>> = {
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
  /** A module-level Database, in a request that may overlap another: its own client. */
  async "/shared"(env) {
    shared ??= connect(env.DATABASE_URL);
    const backends = await withDatabase(shared, async () => {
      const before = await backend();
      await pause();
      return [before, await backend()];
    });
    return { backends };
  },
  /**
   * A Pool's Database as the request's: statics use it when it was built from their binding's
   * connection string. `?other` builds it from another, which they never use.
   */
  async "/pool"(env, url) {
    const other = new URL(env.DATABASE_URL);
    other.searchParams.set("application_name", "other");
    const connectionString = url.searchParams.has("other") ? other.href : env.DATABASE_URL;
    const pool = new pgModule.Pool({ connectionString });
    const heard: string[] = [];
    const db = connect(pool, { onQuery: (event) => heard.push(event.sql) });
    try {
      // Given twice, it's still the request's only Pool database.
      await withDatabase(db, () => withDatabase([db, db], backend));
    } finally {
      await pool.end();
    }
    return { heard: heard.length };
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = routes[url.pathname];
    if (route === undefined) return new Response("not found", { status: 404 });
    try {
      return Response.json(await route(env, url));
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
