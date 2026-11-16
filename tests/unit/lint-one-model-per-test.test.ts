import oneModelPerTest from "../../scripts/lint/one-model-per-test.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// A test acts on one Model once it starts asserting (CODING_STANDARDS.md, Tests; #413).
ruleTester.run("one-model-per-test", oneModelPerTest, {
  valid: [
    // A global and a lowercase import aren't Models.
    `import { make } from "./make";
    test("waits", async () => {
      expect(await Promise.resolve(1)).toBe(1);
      expect(await make.thing()).toBe(2);
      expect(await JSON.parse("1")).toBe(1);
    });`,
    // One Model acted on, twice.
    `test("validates", async () => {
      const users = db.model(User);
      expect(await users.build().isValid()).toBe(false);
      expect(await users.build({ email: "a" }).isValid()).toBe(true);
    });`,
  ],
  invalid: [
    {
      name: "two Models each validated, one after the other",
      code: `test("both sides end", async () => {
        expect(await db.model(Member).build().isValid()).toBe(false);
        expect(await db.model(Note).build().isValid()).toBe(false);
      });`,
      errors: [{ messageId: "secondModel" }],
    },
    {
      name: "records kept in consts, one destructured from a list",
      code: `test("both sides end", async () => {
        const member = await db.model(Member).find(1);
        const [note] = await db.model(Note).all().toArray();
        expect(await member.isValid()).toBe(false);
        expect(await note!.isValid()).toBe(false);
      });`,
      errors: [{ messageId: "secondModel" }],
    },
    {
      name: "Model classes used directly, one declared and one imported",
      code: `import { Post } from "./models";
      class User extends Model {}
      test("creates", async () => {
        expect(await User.create({ email: "a" })).toBeDefined();
        expect(await Post.create({ title: "b" })).toBeDefined();
      });`,
      errors: [{ messageId: "secondModel" }],
    },
  ],
});
