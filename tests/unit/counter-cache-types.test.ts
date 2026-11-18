import { describe, expectTypeOf, test } from "vite-plus/test";
import {
  batch,
  belongsTo,
  hasMany,
  hasOne,
  Model,
} from "../../packages/active-record/src/index.ts";

class Topic extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  repliesCount: "integer",
  replyTally: "real",
  status: { type: "integer", enum: { open: 0, closed: 1 } },
  updatedAt: "datetime",
  seenAt: "datetime",
}) {
  replies = hasMany(Reply);
  reply = hasOne(Reply);
  author = belongsTo(Topic);
}

class Picture extends Model.define({
  id: { type: "integer", null: false },
  repliesCount: "integer",
}) {}

class Reply extends Model.define({
  id: { type: "integer", null: false },
  topicId: "integer",
}) {}

// Each check is a function that's never called: only its types are tested (#61).
describe("the types of counter caches (#61)", () => {
  test("a belongsTo's counterCache names one of its target's number attributes", () => {
    const check = () => [
      belongsTo(Topic, { counterCache: true }),
      belongsTo(Topic, { counterCache: "replyTally" }),
      belongsTo(Topic, { counterCache: { attribute: "repliesCount", active: false } }),
      belongsTo(Topic, { counterCache: { active: false } }),
      belongsTo([Topic, Picture], { counterCache: "repliesCount" }),
      // @ts-expect-error A string attribute can't keep a count.
      belongsTo(Topic, { counterCache: "title" }),
      // @ts-expect-error An enum's values are its names.
      belongsTo(Topic, { counterCache: "status" }),
      // @ts-expect-error active takes only false.
      belongsTo(Topic, { counterCache: { active: true } }),
      // @ts-expect-error A polymorphic belongsTo's counter is one every listed Model has.
      belongsTo([Topic, Picture], { counterCache: "replyTally" }),
    ];

    expectTypeOf(check).toBeFunction();
  });

  test("a hasMany names the counter it reads; a hasOne takes none", () => {
    const check = () => [
      hasMany(Reply, { counterCache: "replyTally" }),
      // @ts-expect-error A hasOne takes no counterCache.
      hasOne(Reply, { counterCache: "repliesCount" }),
    ];

    expectTypeOf(check).toBeFunction();
  });

  test("resetCounters takes the Model's hasMany names, one or a list, and touch", () => {
    const check = async () => {
      await Topic.resetCounters(1, "replies");
      await Topic.resetCounters(1, ["replies"], { touch: true });
      // @ts-expect-error A hasOne isn't counted.
      await Topic.resetCounters(1, "reply");
      // @ts-expect-error A belongsTo isn't counted.
      await Topic.resetCounters(1, "author");
    };

    expectTypeOf(check).toBeFunction();
  });

  test("the counter writes take { by } and touch, naming datetime attributes", () => {
    const check = async () => {
      await Topic.incrementCounter("repliesCount", 1, { by: 2, touch: "seenAt" });
      await Topic.decrementCounter("repliesCount", [1, 2], { touch: ["seenAt", "updatedAt"] });
      await Topic.updateCounters(1, { repliesCount: 1 }, { touch: true });
      await Topic.where({ id: 1 }).updateCounters({ repliesCount: 1 }, { touch: "seenAt" });
      await batch((b) => [b.updateCounters(Topic, { repliesCount: 1 }, { touch: true })]);
      // @ts-expect-error touch names datetime attributes.
      await Topic.updateCounters(1, { repliesCount: 1 }, { touch: "title" });
    };

    expectTypeOf(check).toBeFunction();
  });
});
