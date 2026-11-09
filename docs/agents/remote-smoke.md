# Remote D1 smoke suite

`tests/remote/` runs a handful of tests against a **real remote D1 database**, to catch what Miniflare's local D1 can't show: D1's error message formats (constraint translation parses them), `meta` fields, the 100-bound-parameter limit, and Sessions with bookmarks.

It connects through Wrangler's remote bindings (`getPlatformProxy` with a `remote: true` D1 binding), so the tests use the same `D1Database` binding API as a Worker. Each run creates its own tables with a unique prefix (`smoke_<time>_<random>_`), drops them when it finishes, and drops tables left behind by runs that crashed more than an hour ago.

It runs only with `vp run test:remote`, which sets `D1_REMOTE_SMOKE=1`. A plain `vp test` (and `vp run coverage` and `vp run validate`) leaves the suite out, even with the three environment variables below set in your shell. Without them, `vp run test:remote` skips the suite.

**Agents ask first.** Having the variables set in the shell is not permission: the suite reaches a real Cloudflare account, so an agent asks the human before running `vp run test:remote`, and says what it ran afterwards.

## One-time setup (a human)

1. **A dedicated test database**, used for nothing else:
   ```sh
   pnpm dlx wrangler d1 create d1-record-smoke
   ```
   Note the `database_id` it prints. The suite connects by id; the name only labels it in the console smoke test's config (`d1-record-smoke` there has no effect).
2. **Turn on read replication** for it, so the Session test proves read-your-writes: without replicas every read goes to the primary, and the test would pass whatever the library did. In the Cloudflare dashboard, open the database's **Settings** page and turn on **Read replication (Beta)**. (Or through the API: `PUT /accounts/{account_id}/d1/database/{database_id}` with `{"read_replication": {"mode": "auto"}}`.)
3. **An API token** (Cloudflare dashboard → My Profile → API Tokens → Create Custom Token), scoped to the one account, with the permissions below (every token and secret the repository uses is listed in [cloudflare-tokens.md](cloudflare-tokens.md)):
   - Account → **D1** → Edit
   - Account → **Workers Scripts** → Edit (remote bindings run through a temporary edge-preview Worker)
   - The account needs a `workers.dev` subdomain, which edge previews use.
4. **Run it locally:**
   ```sh
   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… D1_SMOKE_DATABASE_ID=… vp run test:remote
   ```
5. **In CI:** add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `D1_SMOKE_DATABASE_ID` as repository secrets, then run the **Remote D1 smoke** workflow from the Actions tab. It only runs when started by hand (`workflow_dispatch`), never on push.

## Postgres through Hyperdrive

`tests/remote/hyperdrive.test.ts` runs the PostgreSQL adapter through a **real Hyperdrive** (#269), which local mode can't show, since it doesn't pool connections. It deploys a temporary Worker (`pg-record-smoke-<tag>`, from `tests/remote/hyperdrive/worker.ts`) bound to the Hyperdrive config, calls it, and deletes it. The Worker is public on `workers.dev` while the run lasts, so it answers only requests carrying the run's own random token, and a run killed before it deletes its Worker leaves one that does nothing. Each run deletes `pg-record-smoke-…` Workers older than an hour. It creates its own table with the same `smoke_<time>_<random>_` prefix through the connection string, and drops it, and tables older than an hour, when it finishes. It runs with `vp run test:remote`, and is skipped without the variables below.

1. **A dedicated Postgres database** the Hyperdrive config can reach, used for nothing else, and its connection string.
2. **A Hyperdrive config** for it:
   ```sh
   pnpm dlx wrangler hyperdrive create pg-record-smoke --connection-string="postgres://…"
   ```
   Note the `id` it prints.
3. **The token** above, with Account → **Hyperdrive** → Read added (see [cloudflare-tokens.md](cloudflare-tokens.md)).
4. **Run it locally:**
   ```sh
   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… PG_SMOKE_HYPERDRIVE_ID=… PG_SMOKE_DATABASE_URL=… vp run test:remote
   ```
5. **In CI:** add `PG_SMOKE_HYPERDRIVE_ID` and `PG_SMOKE_DATABASE_URL` as repository secrets too.

## When it fails

A failure here that doesn't happen in `vp test` is a difference between Miniflare and real D1. Fix the library, not the smoke test, and add an integration test for the behavior where Miniflare can show it.
