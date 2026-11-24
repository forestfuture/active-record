import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  Model,
  ReadonlyAttribute,
  ReadonlyRecord,
  type ReadonlyAction,
} from "../../packages/arbor/src/index.ts";

describe("read-only declarations (#358)", () => {
  test("a read-only attribute is declared on a column, and is a compile error otherwise", () => {
    expect(() =>
      Model.define({ id: "integer", slug: { type: "string", readonly: true } }),
    ).not.toThrow();
    // An InvalidModel when it's first used, too: tests/conformance/readonly-attributes.test.ts.
    void (() =>
      Model.define({
        id: "integer",
        // @ts-expect-error -- a virtual attribute is never written, so it can't be read-only
        slug: { type: "string", virtual: true, readonly: true },
      }));
    void (() =>
      Model.define({
        id: "integer",
        // @ts-expect-error -- a secure token is regenerated, so it can't be read-only
        token: { type: "string", secureToken: true, readonly: true },
      }));
  });

  test("a record's mark and a Relation's readonly() are typed", () => {
    class Shelf extends Model.define({ id: "integer", name: "string" }) {}
    const shelf = new Shelf();

    expectTypeOf(shelf.markReadonly()).toEqualTypeOf<Shelf>();
    expectTypeOf(shelf.isReadonly()).toEqualTypeOf<boolean>();
    expectTypeOf(Shelf.readonly).returns.toHaveProperty("toArray");
  });

  test("the errors say what was refused", () => {
    expectTypeOf<ReadonlyRecord["action"]>().toEqualTypeOf<ReadonlyAction>();
    expectTypeOf<ReadonlyAttribute["attribute"]>().toEqualTypeOf<string>();
    expect(new ReadonlyAttribute("Volume", "slug").message).toBe(
      `Volume's "slug" is read-only once it's created; it can't be changed`,
    );
  });
});
