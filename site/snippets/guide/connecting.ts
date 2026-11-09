import { batch, Model, withDatabase } from "@forestfuture/active-record";
import {
  connect,
  withSession,
  type Database,
  type QueryListener,
} from "@forestfuture/active-record/d1";
import { env as workerEnv } from "cloudflare:workers";
import { schema } from "../db/schema";
import { Post, User } from "../getting-started/models";

export const plain = {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    // #region binding
    // No setup: each Model queries the binding its generated schema names during the request.
    const user = await User.findByOrThrow({ email: "ada@example.com" });
    const posts = await Post.where({ userId: user.id }).order({ id: "desc" }).toArray();
    // #endregion binding
    return Response.json(posts);
  },
} satisfies ExportedHandler<Env>;

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

// #region app-wide
// src/models/application-record.ts: every query, from every Model, whichever database runs it.
export abstract class ApplicationRecord extends Model {
  static override schema = schema;

  static override onQuery: QueryListener = ({ model, sql, durationMs, error }) => {
    console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`, error ?? "");
  };
}
// #endregion app-wide

/** What your app exports as its Worker today: a framework's, or your own. */
declare const app: ExportedHandler<Env> & { fetch: NonNullable<ExportedHandler<Env>["fetch"]> };

// #region per-request
// src/worker.ts: one request's queries, tagged with its ID, as JSON lines for Workers Logs.
// `app` stands for what your app exports as its Worker today: a framework's handler, or your own.
export const logged = {
  fetch(request, env, ctx) {
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const db = connect(env.DB, {
      onQuery: ({ model, sql, params, durationMs, error }) =>
        console.log(
          JSON.stringify({
            requestId,
            model,
            ms: Math.round(durationMs),
            sql,
            params,
            error: error instanceof Error ? error.message : undefined,
          }),
        ),
    });

    // Every query from a Model inside (Product.find, user.save(), …) goes through db.
    return withDatabase(db, () => app.fetch(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;
// #endregion per-request

// #region app-wide-development
// Logs only when LOG_SQL is set (in .dev.vars), read from the Worker's env when a query runs.
export abstract class QuietInProduction extends Model {
  static override schema = schema;

  static override onQuery: QueryListener = ({ model, sql, durationMs }) => {
    if ((workerEnv as { LOG_SQL?: string }).LOG_SQL) {
      console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`);
    }
  };
}
// #endregion app-wide-development

export const development = {
  fetch(request, env: Env & { LOG_SQL?: string }, ctx) {
    // #region development
    // LOG_SQL=1 in .dev.vars: logging in development only, nothing in production.
    const onQuery: QueryListener | undefined = env.LOG_SQL
      ? ({ model, sql, durationMs }) => console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`)
      : undefined;

    return withDatabase(connect(env.DB, { onQuery }), () => app.fetch(request, env, ctx));
    // #endregion development
  },
} satisfies ExportedHandler<Env & { LOG_SQL?: string }>;

export const timed = {
  async fetch(_request: Request, env: Env): Promise<Response> {
    // #region server-timing
    let queries = 0;
    let total = 0;
    const db = connect(env.DB, {
      onQuery({ durationMs }) {
        queries += 1;
        total += durationMs;
      },
    });

    const response = await withDatabase(db, async () =>
      Response.json(await User.active().toArray()),
    );
    // Shown in the browser's developer tools, under the request's Timing.
    response.headers.append(
      "server-timing",
      `d1;dur=${total.toFixed(1)};desc="${queries} queries"`,
    );
    return response;
    // #endregion server-timing
  },
} satisfies ExportedHandler<Env>;

export async function inATest(binding: D1Database): Promise<void> {
  // #region test
  // Outside a Worker there's no env.DB to find, so a test names its database.
  await withDatabase(connect(binding), async () => {
    await User.create({ email: "ada@example.com" });
    console.log(await User.count()); // 1
  });
  // #endregion test
}

export const explicit = {
  async fetch(_request: Request, env: Env): Promise<Response> {
    // #region explicit
    const db = connect(env.DB);
    const user = await db.model(User).findByOrThrow({ email: "ada@example.com" });
    // #endregion explicit
    // #region models
    const models = db.models({ User, Post });
    const posts = await models.Post.where({ userId: user.id }).toArray();
    // #endregion models
    return Response.json(posts);
  },
} satisfies ExportedHandler<Env>;

export async function batched(): Promise<void> {
  // #region batch
  const user = User.build({ email: "grace@example.com" });
  const post = Post.build({ userId: user.id, title: "Hello" });

  // Atomic: all written, or none.
  await batch([user.toSave(), post.toSave(), Post.where({ userId: "old" }).toDeleteAll()]);
  // #endregion batch
}

export function several(env: Env, handle: () => Promise<Response>) {
  // #region several
  const onQuery: QueryListener = ({ sql }) => console.log(sql);
  const databases: Database[] = [connect(env.DB, { onQuery }), connect(env.LOGS, { onQuery })];
  return withDatabase(databases, handle); // each Model uses the one on its binding
  // #endregion several
}
