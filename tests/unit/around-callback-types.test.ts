import { describe, expectTypeOf, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";

class Order extends Model.define({
  id: { type: "integer", null: false },
  total: "integer",
}) {}

// Each check is a function that's never called: only its types are tested (#48).
describe("the types of around callbacks (#48)", () => {
  test("each gets the Model's record and a next() that resolves to nothing", () => {
    const check = () => [
      Order.aroundSave(async (order, next) => {
        expectTypeOf(order).toEqualTypeOf<Order>();
        expectTypeOf(next).toEqualTypeOf<() => Promise<void>>();
        await next();
      }),
      Order.aroundCreate((_order, next) => next()),
      Order.aroundUpdate((_order, next) => next()),
      Order.aroundDestroy((_order, next) => next()),
      // @ts-expect-error next takes no arguments.
      Order.aroundSave((_order, next) => next(true)),
    ];

    expectTypeOf(check).toBeFunction();
  });
});
