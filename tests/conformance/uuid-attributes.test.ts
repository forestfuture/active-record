import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from "vite-plus/test";
import { Model, RecordNotFound, type TableAttributes } from "../../packages/arbor/src/index.ts";
import { d1 } from "../../packages/arbor/src/adapters/d1/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** A value the property's type doesn't name, as one from a request would arrive. */
const untyped = (value: unknown) => value as never;

const phoneId = "0b6f8a1e-3c2d-4e5f-9a7b-1c2d3e4f5a6b";

class Device extends Model.define({
  id: { type: "uuid", null: false, generateId: true },
  name: "string",
}) {}

// A generated schema, as `arbor schema` writes it from D1's TEXT key.
const schema = {
  adapter: d1({ binding: "DB" }),
  tables: {
    devices: {
      attributes: { id: { type: "string", null: false, generateId: true }, name: "string" },
      primaryKey: "id",
    },
  },
  models: { Gadget: "devices" },
} as const;

abstract class ApplicationRecord extends Model {
  static override schema = schema;
}

// What `arbor schema` declares for the Model, which merges with its class.
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- the generated declaration
interface Gadget extends TableAttributes<
  typeof schema.tables.devices.attributes,
  (typeof Gadget)["attributes"]
> {}

// A D1 TEXT key overridden as a uuid, keeping its id made in code.
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- the generated declaration
class Gadget extends ApplicationRecord {
  static override table = "devices";
  static override attributes = { id: { type: "uuid", null: false, generateId: true } } as const;
}

describe("uuid attributes", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness({ schema: "uuids" });
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("devices");
    await harness.exec("INSERT INTO devices (id, name) VALUES (?, ?)", [phoneId, "phone"]);
  });

  const devices = () => harness.connect().model(Device);

  describe("a value that isn't a UUID matches nothing", () => {
    test("find throws RecordNotFound", async () => {
      await expect(devices().find("lamp")).rejects.toThrow(RecordNotFound);
      await expect(devices().find(["lamp", phoneId])).rejects.toThrow(RecordNotFound);
    });

    test("findBy resolves to null", async () => {
      expect(await devices().findBy({ id: "lamp" })).toBeNull();
      expect(await devices().findBy({ id: untyped(7) })).toBeNull();
    });

    test("a list leaves it out, and the rest still match", async () => {
      const found = await devices()
        .where({ id: ["lamp", phoneId] })
        .toArray();

      expect(found.map(({ name }) => name)).toEqual(["phone"]);
    });

    test("whereNot with it excludes nothing", async () => {
      expect(await devices().whereNot({ id: "lamp" }).count()).toBe(1);
    });
  });

  describe("one form", () => {
    test.each([
      ["capitals", phoneId.toUpperCase()],
      ["braces", `{${phoneId}}`],
      ["no hyphens", phoneId.replaceAll("-", "")],
      ["a hyphen after every four digits", "0b6f-8a1e-3c2d-4e5f-9a7b-1c2d-3e4f-5a6b"],
    ])("a UUID in %s is held lowercase with hyphens", (_, given) => {
      expect(Device.build({ id: given }).id).toBe(phoneId);
    });

    test("a condition in another form finds the record", async () => {
      expect((await devices().findBy({ id: `{${phoneId.toUpperCase()}}` }))?.name).toBe("phone");
    });

    test("assigning another form of the value it holds isn't a change", async () => {
      const device = await devices().find(phoneId);

      device.id = phoneId.toUpperCase();

      expect(device.changed()).toEqual([]);
    });
  });

  describe("assigning", () => {
    test.each([
      ["a word", "lamp", '"lamp"'],
      ["a UUID one digit short", phoneId.slice(0, -1), `"${phoneId.slice(0, -1)}"`],
      ["a UUID with a hyphen at its end", `${phoneId}-`, `"${phoneId}-"`],
      ["one brace", `{${phoneId}`, `"{${phoneId}"`],
      ["spaces", ` ${phoneId}`, `" ${phoneId}"`],
      ["a number", 7, "7"],
    ])("%s is a TypeError", (_, value, shown) => {
      expect(() => Device.build({ id: untyped(value) })).toThrow(
        new TypeError(`Device: ${shown} isn't a UUID for "id"`),
      );
    });
  });

  describe("a generated text key overridden as a uuid", () => {
    const gadgets = () => harness.connect().model(Gadget);

    test("is typed as a string, its id still made in code", () => {
      expectTypeOf<Gadget["id"]>().toEqualTypeOf<string>();

      expect(gadgets().build().id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
    });

    test("finds nothing for a value that isn't a UUID", async () => {
      await expect(gadgets().find("lamp")).rejects.toThrow(RecordNotFound);
    });

    test("finds its record by a UUID in another form", async () => {
      expect((await gadgets().find(phoneId.toUpperCase())).name).toBe("phone");
    });
  });

  test("a UUID finds its record", async () => {
    expect((await devices().find(phoneId)).name).toBe("phone");
  });
});
