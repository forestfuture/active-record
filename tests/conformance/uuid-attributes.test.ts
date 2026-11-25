import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, RecordNotFound } from "../../packages/arbor/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const known = "0b6f8a1e-3c2d-4e5f-9a7b-1c2d3e4f5a6b";

class Device extends Model.define({
  id: { type: "uuid", null: false, generateId: true },
  name: "string",
}) {}

describe("uuid attributes", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness({ schema: "uuids" });
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("devices");
    await harness.exec("INSERT INTO devices (id, name) VALUES (?, ?)", [known, "phone"]);
  });

  const devices = () => harness.connect().model(Device);

  describe("a value that isn't a UUID matches nothing", () => {
    test("find throws RecordNotFound", async () => {
      await expect(devices().find("ada")).rejects.toThrow(RecordNotFound);
      await expect(devices().find(["ada", known])).rejects.toThrow(RecordNotFound);
    });
  });

  test("a UUID finds its record", async () => {
    expect((await devices().find(known)).name).toBe("phone");
  });
});
