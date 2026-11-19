import { describe, expectTypeOf, test } from "vite-plus/test";
import { hasOne, Model } from "../../packages/active-record/src/index.ts";

class Discussion extends Model.define({
  id: { type: "integer", null: false },
  forumId: "integer",
  title: "string",
  updatedAt: "datetime",
  lastMessageAt: "datetime",
}) {}

// Each check is a function that's never called: only its types are tested (#497).
describe("the types of a hasOne's touch (#497)", () => {
  test("touch is true, or names its target's datetime attributes", () => {
    const check = () => [
      hasOne(Discussion, { touch: true }),
      hasOne(Discussion, { touch: "lastMessageAt" }),
      hasOne(Discussion, { touch: ["lastMessageAt", "updatedAt"] }),
      hasOne(Discussion, { through: "forum", touch: true }),
      // @ts-expect-error touch names datetime attributes.
      hasOne(Discussion, { touch: "title" }),
      // @ts-expect-error touch takes true, not false.
      hasOne(Discussion, { touch: false }),
    ];

    expectTypeOf(check).toBeFunction();
  });
});
