// A Model's signing secret in workerd (#517): read from the Worker's env through
// cloudflare:workers, which the core imports itself, in a Worker Wrangler bundles. No Node.js
// compatibility, so process.env isn't there to fall back on.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { describe, expect, test } from "vite-plus/test";
import { runWrangler } from "../../support/worker-app.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();
const source = new URL("../../../packages/active-record/src/", import.meta.url).pathname;
const secret = "the-worker-secret-of-at-least-32-bytes";

/** A Worker that signs a note's id with SECRET_KEY_BASE, and finds it with secrets given outright. */
const worker = `
import { Model } from "${source}index.ts";
import { connect } from "${source}adapters/d1/index.ts";

class Note extends Model.define({ id: { type: "integer", null: false }, body: "string" }) {
  static table = "notes";
}
class SameSecret extends Note {
  static signingSecret() { return ${JSON.stringify(secret)}; }
}
class OtherSecret extends Note {
  static signingSecret() { return "another-secret-of-at-least-32-bytes"; }
}

export default {
  async fetch(_request, env) {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)");
    const db = connect(env.DB);
    const note = await db.model(Note).create({ body: "Hello" });
    const signedId = await note.signedId();
    return Response.json({
      bySameSecret: (await db.model(SameSecret).findSigned(signedId))?.id === note.id,
      byOtherSecret: await db.model(OtherSecret).findSigned(signedId),
    });
  },
};
`;

describe("a signing secret in workerd", () => {
  test("is SECRET_KEY_BASE from the Worker's env", async () => {
    const cwd = scratch("signing-");
    writeFileSync(join(cwd, "index.ts"), worker);
    const config = { name: "signing", main: "index.ts", compatibility_date: "2026-01-01" };
    writeFileSync(join(cwd, "wrangler.jsonc"), JSON.stringify(config));
    runWrangler(cwd, ["deploy", "--dry-run", "--outdir", join(cwd, ".bundle")]);
    const mf = new Miniflare({
      modules: true,
      scriptPath: join(cwd, ".bundle", "index.js"),
      compatibilityDate: "2025-09-01",
      d1Databases: ["DB"],
      bindings: { SECRET_KEY_BASE: secret },
    });

    try {
      const response = await mf.dispatchFetch("http://localhost/");

      expect(await response.json()).toEqual({ bySameSecret: true, byOtherSecret: null });
    } finally {
      await mf.dispose();
    }
  }, 60_000);
});
