// The Workers types a Worker project has, and the Env that `wrangler types` writes from wrangler.jsonc.
/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
  LOG_SQL?: string; // set only in .dev.vars
}
