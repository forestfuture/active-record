// A Model's signing secret inside a Worker (#517): read from the env cloudflare:workers gives,
// before any process.env.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { Model } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

// The Worker's env, as cloudflare:workers gives it; here it holds this test's secret.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

const workerSecret = "the-worker-secret-of-at-least-32-bytes";

class Note extends Model.define({ id: { type: "integer", null: false }, body: "string" }) {
  static override table = "notes";
}

// The same table, its secret given outright.
class SignedNote extends Model.define({ id: { type: "integer", null: false }, body: "string" }) {
  static override table = "notes";
  static override signingSecret() {
    return workerSecret;
  }
}

describe("a signing secret in a Worker", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const db = () => connect(binding);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
  });
  afterAll(() => dispose());
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("is SECRET_KEY_BASE from the Worker's env, not the process's", async () => {
    workers.env.SECRET_KEY_BASE = workerSecret;
    vi.stubEnv("SECRET_KEY_BASE", "the-process-secret-of-at-least-32-bytes");
    const note = await db().model(Note).create({ body: "Hello" });

    const signedId = await note.signedId();

    expect((await db().model(SignedNote).findSigned(signedId))?.id).toBe(note.id);
  });
});
