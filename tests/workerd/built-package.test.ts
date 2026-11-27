// The built package in workerd (#10): its packed tarball, imported by name in a Worker that
// Wrangler bundles as an app's is, run by Miniflare on a real D1. Needs `vp run build` first.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { startMiniflare } from "../support/miniflare.ts";
import { scratchDirs } from "../support/scratch.ts";
import { runWrangler } from "../support/wrangler.ts";

const pkg = new URL("../../packages/arbor/", import.meta.url).pathname;
const fixture = new URL("../fixtures/workerd/built/", import.meta.url).pathname;
const scratch = scratchDirs();

/** The Worker's compatibility settings, for Wrangler's bundle and Miniflare's runtime alike. */
const compatibility = { date: "2026-01-01", flags: ["nodejs_compat"] };

/**
 * A folder outside the repo holding the packed package in its node_modules, as an app installs
 * it, so nothing the Worker imports can come from the workspace's sources.
 */
function installPacked(): string {
  if (!existsSync(join(pkg, "dist/index.mjs"))) {
    throw new Error("The package isn't built: run `vp run build` first.");
  }
  const app = scratch("built-package-", true);
  const tarball = join(app, "arbor.tgz");
  execFileSync("pnpm", ["pack", "--out", tarball, "--config.ignore-scripts=true"], {
    cwd: pkg,
    stdio: "pipe",
  });
  const installed = join(app, "node_modules/@forestfuture/arbor");
  mkdirSync(installed, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", installed, "--strip-components=1"]);
  return app;
}

/** The app's Worker, bundled by Wrangler's own build as a deploy is, without uploading it. */
function bundle(app: string): string {
  cpSync(fixture, app, { recursive: true });
  const config = {
    name: "built-package",
    main: "worker.ts",
    compatibility_date: compatibility.date,
    compatibility_flags: compatibility.flags,
  };
  writeFileSync(join(app, "wrangler.jsonc"), JSON.stringify(config));
  runWrangler(app, ["deploy", "--dry-run", "--outdir", join(app, "bundle")]);
  return join(app, "bundle/worker.js");
}

describe("the built package in workerd", () => {
  let mf: Miniflare;
  let body: Record<string, unknown>;

  beforeAll(async () => {
    mf = startMiniflare({
      main: bundle(installPacked()),
      compatibilityDate: compatibility.date,
      compatibilityFlags: compatibility.flags,
      d1: { DB: "DB" },
    });
    const db = await mf.getD1Database("DB");
    await db.exec("CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT NOT NULL)");
    await db.exec(
      "CREATE TABLE reviews (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, body TEXT NOT NULL)",
    );
    await db.prepare("INSERT INTO products (id, title) VALUES (1, 'Lamp')").run();
    const response = await mf.dispatchFetch("http://localhost/");
    body = (await response.json()) as Record<string, unknown>;
  }, 120_000);
  afterAll(async () => {
    await mf?.dispose();
  });

  test("answers without an error", () => {
    expect(body["error"]).toBeUndefined();
  });

  test("a Model's static query uses its binding from cloudflare:workers", () => {
    expect(body["found"]).toBe("Lamp");
  });

  test("withDatabase's database serves the Models' write and its read back", () => {
    expect(body["readBack"]).toBe("Sturdy");
    expect(body["heard"]).toBeGreaterThan(0);
  });

  test("includes loads an association", () => {
    expect(body["reviews"]).toEqual(["Sturdy"]);
  });

  test("a Model's class name survives Wrangler's bundle", () => {
    expect(body["className"]).toBe("Product");
  });
});
