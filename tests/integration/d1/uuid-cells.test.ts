// A uuid attribute over a D1 TEXT key (#507): a cell not in the one form a uuid is held in fails
// when it's read, since a write by the held key would miss its row, as D1 compares text exactly.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../../packages/arbor/src/index.ts";
import { connect } from "../../../packages/arbor/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

class Device extends Model.define({ id: { type: "uuid", null: false }, name: "string" }) {}

const phoneId = "0b6f8a1e-3c2d-4e5f-9a7b-1c2d3e4f5a6b";

describe("a uuid attribute's cells on D1", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(
      new URL("../../fixtures/sqlite/uuids.sql", import.meta.url),
    ));
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM devices").run();
  });

  const devices = () => connect(binding).model(Device);
  const insert = (id: string) =>
    binding.prepare("INSERT INTO devices (id, name) VALUES (?, 'phone')").bind(id).run();

  test.each([
    ["capitals", phoneId.toUpperCase()],
    ["braces", `{${phoneId}}`],
    ["no hyphens", phoneId.replaceAll("-", "")],
  ])("a UUID stored in %s fails when it's read", async (_, stored) => {
    await insert(stored);

    await expect(devices().toArray()).rejects.toThrow(
      new TypeError(`Device: "${stored}" isn't a UUID for "id"`),
    );
  });

  test("pluck refuses a UUID stored in capitals", async () => {
    const stored = phoneId.toUpperCase();
    await insert(stored);

    await expect(devices().pluck("id")).rejects.toThrow(
      new TypeError(`Device: "${stored}" isn't a UUID for "id"`),
    );
  });
});
