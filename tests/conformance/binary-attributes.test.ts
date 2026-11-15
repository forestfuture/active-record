import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { gt, Model } from "../../packages/active-record/src/index.ts";
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

  describe("conditions", () => {
    const bytes = (...values: number[]) => new Uint8Array(values);

    beforeEach(async () => {
      await attachments().create({ id: 1, name: "a", digest: bytes(1, 2) });
      await attachments().create({ id: 2, name: "b", digest: bytes(1, 10) });
      await attachments().create({ id: 3, name: "c", digest: bytes(2) });
    });

    test("where finds a record by its bytes, or by a list of them", async () => {
      expect(
        await attachments()
          .where({ digest: bytes(1, 10) })
          .pluck("name"),
      ).toEqual(["b"]);
      expect(
        await attachments()
          .where({ digest: [bytes(2), bytes(1, 2)] })
          .order({ id: "asc" })
          .pluck("name"),
      ).toEqual(["a", "c"]);
      expect(
        await attachments().findBy({ digest: new Uint8Array([1, 2]).buffer as never }),
      ).toMatchObject({ name: "a" });
    });

    test("a value that isn't bytes matches nothing", async () => {
      expect(
        await attachments()
          .where({ digest: untyped("\u0001\u0002") })
          .count(),
      ).toBe(0);
    });

    test("bytes compare and order byte by byte", async () => {
      expect(
        await attachments()
          .where({ digest: gt(bytes(1, 2)) })
          .order({ digest: "asc" })
          .pluck("name"),
      ).toEqual(["b", "c"]);
      expect(await attachments().order({ digest: "desc" }).pluck("name")).toEqual(["c", "b", "a"]);
    });
  });

  describe("bulk writes", () => {
    const stored = async () =>
      (await attachments().order({ id: "asc" }).toArray()).map(({ name, data }) => [
        name,
        data === null ? null : [...data],
      ]);

    test("insertAll writes each row's bytes, an empty array and NULL included", async () => {
      await attachments().insertAll([
        { id: 1, name: "a", data: new Uint8Array([0, 255]) },
        { id: 2, name: "b", data: new Uint8Array([]) },
        { id: 3, name: "c", data: null },
      ]);

      expect(await stored()).toEqual([
        ["a", [0, 255]],
        ["b", []],
        ["c", null],
      ]);
    });

    test("upsertAll replaces a row's bytes", async () => {
      await attachments().create({ id: 1, name: "a", data: new Uint8Array([1]) });

      await attachments().upsertAll(
        [
          { id: 1, name: "a", data: new Uint8Array([2, 3]) },
          { id: 2, name: "b", data: new Uint8Array([4]) },
        ],
        { uniqueBy: ["id"] },
      );

      expect(await stored()).toEqual([
        ["a", [2, 3]],
        ["b", [4]],
      ]);
    });

    test("updateAll sets every row's bytes", async () => {
      await attachments().create({ id: 1, name: "a", data: new Uint8Array([1]) });

      await attachments().updateAll({ data: new Uint8Array([5, 6]) });

      expect(await stored()).toEqual([["a", [5, 6]]]);
    });
  });

  describe("typeForAttribute", () => {
    const { cast, serialize, deserialize } = Attachment.typeForAttribute("data");

    test("serialize gives bytes a raw statement binds, and deserialize reads its cell back", async () => {
      const stored = serialize(new Uint8Array([4, 5]).buffer);
      await harness.exec("INSERT INTO attachments (id, data) VALUES (1, ?)", [stored]);

      const [row] = await harness.exec("SELECT data FROM attachments");

      expect([...deserialize(row!["data"])!]).toEqual([4, 5]);
      expect([...(await attachments().find(1)).data!]).toEqual([4, 5]);
    });

    test("cast refuses what assigning refuses", () => {
      expect(() => cast("abc")).toThrow(
        new TypeError('Attachment: "abc" isn\'t binary data for "data"'),
      );
    });
  });
});
