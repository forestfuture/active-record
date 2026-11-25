// Declaring a uuid attribute (#507): its property is a string, it takes generateId, and a spec
// only a string can have is refused. No database.
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { InvalidModel, Model } from "../../packages/arbor/src/index.ts";
import { connect } from "../../packages/arbor/src/adapters/d1/index.ts";

const db = connect({} as never);

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("a uuid attribute's declaration", () => {
  test("is typed as a string", () => {
    class Device extends Model.define({
      id: { type: "uuid", null: false },
      ownerId: "uuid",
    }) {}

    expectTypeOf<Device["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Device["ownerId"]>().toEqualTypeOf<string | null>();
  });

  test("takes generateId, whose UUID a built record has", () => {
    class Device extends Model.define({ id: { type: "uuid", null: false, generateId: true } }) {}

    expect(db.model(Device).build().id).toMatch(uuid);
  });

  test("refuses a generated id that isn't a UUID when a record is built", () => {
    class Device extends Model.define({ id: { type: "uuid", null: false, generateId: true } }) {
      static override generateId = (attribute: string) => `${attribute}_1`;
    }

    expect(() => db.model(Device).build()).toThrow(
      new TypeError(`Device: "id_1" isn't a UUID for "id"`),
    );
  });

  test("refuses an enum", () => {
    class Device extends Model.define({
      id: { type: "integer", null: false },
      // @ts-expect-error -- only a string or an integer has an enum
      kind: { type: "uuid", enum: ["a"] },
    }) {}

    expect(() => db.model(Device)).toThrow(
      new InvalidModel(
        'Device.kind is "uuid", so it can\'t have an enum: an enum is stored as text or integers',
      ),
    );
  });

  test("refuses a secure token", () => {
    class Device extends Model.define({
      id: { type: "integer", null: false },
      // @ts-expect-error -- only a string has a secure token
      kind: { type: "uuid", secureToken: true },
    }) {}

    expect(() => db.model(Device)).toThrow(
      new InvalidModel('Device.kind is "uuid", so it can\'t have secureToken: a token is a string'),
    );
  });
});
