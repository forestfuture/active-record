import { type QueryListener, withDatabase } from "@forestfuture/active-record";
import { connect } from "@forestfuture/active-record/d1";
import { app } from "./src/app";

// #region per-request
// src/worker.ts: one request's queries, tagged with its ID, as JSON lines for Workers Logs.
export const worker = {
  fetch(request, env) {
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const db = connect(env.DB, {
      onQuery: ({ model, sql, params, durationMs, error }) =>
        console.log(
          JSON.stringify({
            requestId,
            model,
            ms: Math.round(durationMs),
            sql,
            params, // a filtered attribute's value is "[FILTERED]"
            error: error instanceof Error ? error.message : undefined,
          }),
        ),
    });

    // Every query from a Model inside (User.findBy, user.save(), …) goes through db.
    return withDatabase(db, () => app.fetch(request));
  },
} satisfies ExportedHandler<Env>;
// #endregion per-request

// #region development
// src/worker.ts, with LOG_SQL=1 in .dev.vars: logging in development only, nothing in production.
export const development = {
  fetch(request, env) {
    const onQuery: QueryListener | undefined = env.LOG_SQL
      ? ({ model, sql, durationMs }) => console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`)
      : undefined;

    return withDatabase(connect(env.DB, { onQuery }), () => app.fetch(request));
  },
} satisfies ExportedHandler<Env>;
// #endregion development

// #region server-timing
// src/worker.ts: the request's database time, under its Timing in the browser's developer tools.
export const timed = {
  async fetch(request, env) {
    let queries = 0;
    let total = 0;
    const db = connect(env.DB, {
      onQuery({ durationMs }) {
        queries += 1;
        total += durationMs;
      },
    });

    const response = await withDatabase(db, () => app.fetch(request));
    response.headers.append(
      "server-timing",
      `db;dur=${total.toFixed(1)};desc="${queries} queries"`,
    );
    return response;
  },
} satisfies ExportedHandler<Env>;
// #endregion server-timing
