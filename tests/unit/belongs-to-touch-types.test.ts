import { describe, expectTypeOf, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/active-record/src/index.ts";

class Discussion extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  updatedAt: "datetime",
  lastMessageAt: "datetime",
}) {}

class Forum extends Model.define({
  id: { type: "integer", null: false },
  updatedAt: "datetime",
  lastActivityAt: "datetime",
}) {}

class Message extends Model.define({
  id: { type: "integer", null: false },
  discussionId: "integer",
}) {}

// Each check is a function that's never called: only its types are tested (#353).
describe("the types of a belongsTo's touch (#353)", () => {
  test("touch is true, or names its target's datetime attributes", () => {
    const check = () => [
      belongsTo(Discussion, { touch: true }),
      belongsTo(Discussion, { touch: "lastMessageAt" }),
      belongsTo(Discussion, { touch: ["lastMessageAt", "updatedAt"] }),
      belongsTo([Discussion, Forum], { touch: "updatedAt" }),
      // @ts-expect-error touch names datetime attributes.
      belongsTo(Discussion, { touch: "title" }),
      // @ts-expect-error A polymorphic belongsTo's touch names what every listed Model has.
      belongsTo([Discussion, Forum], { touch: "lastMessageAt" }),
      // @ts-expect-error touch takes true, not false.
      belongsTo(Discussion, { touch: false }),
    ];

    expectTypeOf(check).toBeFunction();
  });

  test("a hasMany takes no touch", () => {
    const check = () => [
      // @ts-expect-error A hasMany takes no touch.
      hasMany(Message, { touch: true }),
    ];

    expectTypeOf(check).toBeFunction();
  });
});
