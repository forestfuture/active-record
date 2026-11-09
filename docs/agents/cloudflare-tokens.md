# Cloudflare tokens and secrets

The repository's GitHub Actions use two Cloudflare API tokens, each with only the permissions its job needs. Create them in the Cloudflare dashboard under My Profile → API Tokens → **Create Custom Token**, scoped to the one account.

| GitHub secret               | Used by                                                                                         | Permissions                                                                                        | Resources                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`      | The remote D1 smoke suite: `vp run test:remote`, and the **Remote D1 smoke** workflow (by hand) | Account → **D1** → Edit<br>Account → **Workers Scripts** → Edit<br>Account → **Hyperdrive** → Read | The account                                       |
| `CLOUDFLARE_DOCS_API_TOKEN` | The documentation deploy: the `docs-deploy` job in `ci.yml`, on pushes to `main`                | Account → **Workers Scripts** → Edit<br>Zone → **Workers Routes** → Edit<br>Zone → **Zone** → Read | The account, and the zone `forestfuture.dev` only |

The token can replace any Worker in the account, so the job that holds it runs only a pinned Wrangler, never the site's dependencies. The `docs-build` job builds the guide with no secrets and hands the deploy job its files. The deploy job installs Wrangler from `.github/docs-deploy`, which has a lockfile of its own, with install scripts off.

Both workflows also need these secrets, which aren't tokens:

| GitHub secret            | Value                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`  | The account ID, from the account's Workers & Pages overview page                                                  |
| `D1_SMOKE_DATABASE_ID`   | The `d1-record-smoke` database's ID (see [remote-smoke.md](remote-smoke.md))                                      |
| `PG_SMOKE_HYPERDRIVE_ID` | The `pg-record-smoke` Hyperdrive config's ID (see [remote-smoke.md](remote-smoke.md#postgres-through-hyperdrive)) |
| `PG_SMOKE_DATABASE_URL`  | The connection string of the Postgres database that config reaches                                                |

## Why each permission

- **D1 → Edit**: the smoke suite creates, writes and reads its tables in `d1-record-smoke`.
- **Workers Scripts → Edit**:
  - Smoke token: Wrangler's remote bindings run through a temporary preview Worker, so the account also needs a `workers.dev` subdomain. The Hyperdrive smoke deploys its own `pg-record-smoke-…` Worker on it, lists the account's Workers to delete stale ones, and deletes its own.
  - Docs token: it creates and updates three Workers and uploads their files: `active-record-docs`, the guide (`site/wrangler.jsonc`), `forestfuture-docs`, the library list at `docs.forestfuture.dev` (`site/host/wrangler.jsonc`), and `d1-record-docs`, which redirects the guide's old host (`site/redirect/wrangler.jsonc`). That Worker served the guide until #270, so keeping its name let the redirect replace it, route and all.
- **Hyperdrive → Read**: the Hyperdrive smoke binds its Worker to the existing `pg-record-smoke` config, and changes no config. If Wrangler refuses the deploy for want of a permission, raise it to Edit and say so here.
- **Workers Routes → Edit**: attaches `active-record.forestfuture.dev/*` to the guide's Worker, `docs.forestfuture.dev/*` to the library list's, and `d1-record.forestfuture.dev/*` to the redirect's.
- **Zone → Read**: the route names its zone by name (`forestfuture.dev`), and Wrangler looks up the zone's ID.

**User → User Details → Read** isn't needed. Wrangler only prints a warning without it, and leaving it out gives Wrangler less to print when something fails. Actions logs are readable by anyone who can see the repository.

## The docs hostnames

A Worker route only runs on a hostname with a proxied DNS record, and the docs token can't edit DNS. `docs.forestfuture.dev` and `d1-record.forestfuture.dev` have one. For `active-record.forestfuture.dev`, add it once in the dashboard, before the first deploy that routes it: **forestfuture.dev → DNS → Records → Add record**, type `AAAA`, name `active-record`, IPv6 address `100::`, **Proxied**. Keep `d1-record`'s record, so its redirect keeps answering. `100::` is a placeholder: the route answers every request, so the address is never reached. Cloudflare's Universal SSL certificate covers `*.forestfuture.dev`, so the hostname needs no certificate of its own.

## Replacing a token

1. Create the new token with the permissions above.
2. Update the secret with `gh secret set CLOUDFLARE_DOCS_API_TOKEN` (or `CLOUDFLARE_API_TOKEN`). It prompts for the value, so the token never appears in your shell history.
3. Delete the old token in the dashboard.

A token that has expired, or lacks a permission, fails with `Authentication error [code: 10000]`.
