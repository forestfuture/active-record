import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** A value the property's type doesn't name, as one from a request would arrive. */
const untyped = (value: unknown) => value as never;

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

  describe("assigning", () => {
    test("an ArrayBuffer is its bytes", () => {
      const attachment = Attachment.build({ data: untyped(new Uint8Array([7, 8]).buffer) });

      expect(attachment.data).toBeInstanceOf(Uint8Array);
      expect([...attachment.data!]).toEqual([7, 8]);
    });

    test.each([
      ["text", "abc", '"abc"'],
      ["an array of numbers", [1, 2], "[1,2]"],
      ["another typed array", new Uint16Array([1]), '{"0":1}'],
      ["a DataView", new DataView(new ArrayBuffer(1)), "{}"],
    ])("%s is a TypeError", (_, value, shown) => {
      expect(() => Attachment.build({ data: untyped(value) })).toThrow(
        new TypeError(`Attachment: ${shown} isn't binary data for "data"`),
      );
    });

    test("a file from a form is a TypeError saying how to read its bytes", () => {
      const form = new FormData();
      form.append("data", new File(["x"], "x.txt"));

      expect(() => Attachment.permit(form, "data")).toThrow(
        new TypeError(
          'Attachment: "data" is a file; assign its bytes: new Uint8Array(await file.arrayBuffer())',
        ),
      );
    });
  });

  describe("change tracking", () => {
    test("assigning the same bytes in another array isn't a change", async () => {
      const { id } = await attachments().create({ data: new Uint8Array([1, 2]) });
      const attachment = await attachments().find(id);

      attachment.data = new Uint8Array([1, 2]);

      expect(attachment.isChanged()).toBe(false);
    });

    test("a byte changed in place is a change, and saving writes it", async () => {
      const { id } = await attachments().create({ data: new Uint8Array([1, 2]) });
      const attachment = await attachments().find(id);

      attachment.data![0] = 9;

      expect(attachment.isChanged()).toBe(true);
      await attachment.save();
      expect([...(await attachments().find(id)).data!]).toEqual([9, 2]);
    });
  });
});
