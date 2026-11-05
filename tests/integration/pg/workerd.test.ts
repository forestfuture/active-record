import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";
import { scratchDirs } from "../../support/scratch.ts";

const fixture = new URL("../../fixtures/workerd/pg/", import.meta.url).pathname;
const wrangler = new URL("../../../node_modules/.bin/wrangler", import.meta.url).pathname;
const scratch = scratchDirs();

// pg-record bundled by Wrangler, as an app's Worker is, and run in workerd (#269).
describe("pg-record in workerd", { timeout: 60_000 }, () => {
  let schema: PgSchema;
  let mf: Miniflare;

  const get = async (path: string) => {
    const response = await mf.dispatchFetch(`http://localhost${path}`);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["error"]).toBeUndefined();
    return body;
  };

  beforeAll(async () => {
    schema = await openPgSchema();
    const out = scratch("pg-worker-");
    execFileSync(wrangler, ["deploy", "--dry-run", "--outdir", out, "--config", "wrangler.jsonc"], {
      cwd: fixture,
      stdio: "pipe",
    });
    mf = new Miniflare({
      modules: true,
      scriptPath: join(out, "worker.js"),
      compatibilityDate: "2025-09-01",
      compatibilityFlags: ["nodejs_compat"],
      bindings: { DATABASE_URL: schema.url },
    });
  }, 120_000);
  afterAll(async () => {
    await mf?.dispose();
    await schema?.dispose();
  });

  test("a Model's statics use the binding's own database, a client per query, each closed", async () => {
    const { email, backends } = (await get("/statics")) as { email: string; backends: number[] };

    expect(email).toBe("worker@example.com");
    expect(backends[0]).not.toBe(backends[1]);
    await expect.poll(() => schema.connections()).toBe(0);
  });

  test.each(["/scope", "/hyperdrive"])(
    "%s: a request's database holds one client for its withDatabase scope",
    async (path) => {
      const { backends } = (await get(path)) as { backends: number[] };

      expect(backends).toHaveLength(2);
      expect(backends[0]).toBe(backends[1]);
      await expect.poll(() => schema.connections()).toBe(0);
    },
  );
});
