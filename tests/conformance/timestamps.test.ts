import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { ConstraintViolation, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class ApiKey extends Model.define({
  id: { type: "string", null: false },
  label: { type: "string", null: false },
  createdAt: "datetime",
  updatedAt: "datetime",
}) {
  static table = "api_keys";
}

const past = new Date(Date.UTC(2020, 0, 1));

describe("timestamps", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.exec("DELETE FROM api_keys");
  });

  test("creating a record sets createdAt and updatedAt to now", async () => {
    const before = Date.now();
    const key = await harness.connect().model(ApiKey).create({ id: "k1", label: "deploy" });
    const after = Date.now();

    expect(key.createdAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(key.createdAt?.getTime()).toBeLessThanOrEqual(after);
    expect(key.updatedAt).toEqual(key.createdAt);
  });

  test("explicit timestamps on create are kept", async () => {
    const key = await harness
      .connect()
      .model(ApiKey)
      .create({ id: "k1", label: "deploy", createdAt: past, updatedAt: past });

    const stored = await harness.connect().model(ApiKey).find("k1");

    expect(key.createdAt).toEqual(past);
    expect(stored.updatedAt).toEqual(past);
  });

  test("after a create, savedChanges includes the timestamps it set", async () => {
    const key = await harness.connect().model(ApiKey).create({ id: "k1", label: "deploy" });

    expect(key.savedChanges()).toEqual({
      id: [null, "k1"],
      label: [null, "deploy"],
      createdAt: [null, key.createdAt],
      updatedAt: [null, key.updatedAt],
    });
  });

  test("saving a change moves updatedAt forward and leaves createdAt alone", async () => {
    await harness
      .connect()
      .model(ApiKey)
      .create({ id: "k1", label: "deploy", createdAt: past, updatedAt: past });
    const key = await harness.connect().model(ApiKey).find("k1");
    const before = Date.now();

    key.label = "release";
    await key.save();

    const stored = await harness.connect().model(ApiKey).find("k1");
    expect(stored.updatedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored.createdAt).toEqual(past);
  });

  test("a clean save doesn't touch updatedAt, and an explicit updatedAt is kept", async () => {
    await harness
      .connect()
      .model(ApiKey)
      .create({ id: "k1", label: "deploy", createdAt: past, updatedAt: past });
    const queries: QueryEvent[] = [];
    const keys = harness.connect({ onQuery: (event) => queries.push(event) }).model(ApiKey);
    const key = await keys.find("k1");
    queries.length = 0;

    await key.save();
    expect(queries).toHaveLength(0);

    const chosen = new Date(Date.UTC(2024, 5, 1));
    key.label = "release";
    key.updatedAt = chosen;
    await key.save();
    expect((await keys.find("k1")).updatedAt).toEqual(chosen);
  });

  test("a failed insert leaves only the caller's changes, not timestamps", async () => {
    const keys = harness.connect().model(ApiKey);
    await keys.create({ id: "k1", label: "deploy" });
    const duplicate = keys.build({ id: "k1", label: "again" });

    await expect(duplicate.save()).rejects.toThrow(ConstraintViolation);

    expect(duplicate.changed().sort()).toEqual(["id", "label"]);
    expect(duplicate.createdAt).toBeNull();
  });

  test("a failed update leaves only the caller's changes, so reverting them makes it clean", async () => {
    await harness
      .connect()
      .model(ApiKey)
      .create({ id: "k1", label: "deploy", createdAt: past, updatedAt: past });
    const queries: QueryEvent[] = [];
    const keys = harness.connect({ onQuery: (event) => queries.push(event) }).model(ApiKey);
    const key = await keys.find("k1");

    key.label = null as never;
    await expect(key.save()).rejects.toThrow(ConstraintViolation);
    expect(key.changed()).toEqual(["label"]);

    key.label = "deploy";
    queries.length = 0;
    await key.save();
    expect(key.isChanged()).toBe(false);
    expect(key.updatedAt).toEqual(past);
    expect(queries).toHaveLength(0);
  });

  test("saving a partial record moves updatedAt forward", async () => {
    await harness
      .connect()
      .model(ApiKey)
      .create({ id: "k1", label: "deploy", createdAt: past, updatedAt: past });
    const keys = harness.connect().model(ApiKey);
    const [partial] = await keys.select("label").toArray();
    if (!partial) throw new Error("expected a record");
    const before = Date.now();

    partial.label = "release";
    await partial.save();

    const stored = await keys.find("k1");
    expect(stored.updatedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored.createdAt).toEqual(past);
  });
});
