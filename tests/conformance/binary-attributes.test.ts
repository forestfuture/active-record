import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Attachment extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  data: "binary",
  digest: "binary",
}) {
  static table = "attachments";
}

describe("binary attributes", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("attachments");
  });

  const attachments = () => harness.connect().model(Attachment);

  test("bytes saved read back as a plain Uint8Array of the same bytes", async () => {
    const { id } = await attachments().create({ data: new Uint8Array([0, 1, 254, 255]) });

    const { data } = await attachments().find(id);

    expect(Object.getPrototypeOf(data)).toBe(Uint8Array.prototype);
    expect([...data!]).toEqual([0, 1, 254, 255]);
  });
});
