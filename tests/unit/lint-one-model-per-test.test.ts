import oneModelPerTest from "../../scripts/lint/one-model-per-test.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// A test acts on one Model once it starts asserting (CODING_STANDARDS.md, Tests; #413).
ruleTester.run("one-model-per-test", oneModelPerTest, {
  valid: [
    // expect.assertions() counts assertions to come, so what follows it is still setup.
    `test("refuses", async () => {
      expect.assertions(1);
      await db.model(User).create({ email: "a" });
      await db.model(Post).create({ title: "b" });
      expect(await db.model(Post).count()).toBe(1);
    });`,
    // An association read, and a capitalized helper, aren't actions on a Model.
    `import { Helper } from "./helper";
    test("reads the author", async () => {
      expect(await db.model(User).create({ email: "a" })).toBeDefined();
      const post = db.model(Post).build();
      expect(await post.author()).toBeNull();
      expect(await Helper.settle()).toBe(true);
    });`,
    // A record read through an association isn't taken for its owner's Model.
    `test("validates the author", async () => {
      const post = await db.model(Post).find(1);
      const author = await post.author();
      expect(await post.isValid()).toBe(true);
      expect(await author!.isValid()).toBe(true);
    });`,
    // Acting on one Model, then reading another's rows to see the effect.
    `test("an invalid author makes the post invalid, and nothing is written", async () => {
      const post = db.model(Post).build();
      expect(await post.save()).toBe(false);
      expect(await db.model(User).count()).toBe(2);
      expect(await db.model(User).pluck("id")).toEqual([1, 2]);
      expect(await db.model(User).find(1)).toBeDefined();
      expect(await db.model(User).where({ id: 1 }).toArray()).toHaveLength(1);
      expect(await db.model(User).first()).toBeDefined();
      expect(await db.model(User).find(1).then((user) => user.email)).toBe("a");
    });`,
    // Arranging records of other Models before the first assertion.
    `test("saves the post", async () => {
      const user = await db.model(User).create({ email: "a" });
      await db.model(Comment).create({ body: "c" });
      expect(await db.model(Post).build({ userId: user.id }).save()).toBe(true);
    });`,
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
    {
      name: "an action inside expect(…).rejects, after another Model's",
      code: `test("refuses", async () => {
        expect(await db.model(User).create({ email: "a" })).toBeDefined();
        await expect(db.model(Post).build().saveOrThrow()).rejects.toThrow();
      });`,
      errors: [{ messageId: "secondModel" }],
    },
    {
      // An opt-out goes on the line before the statement, so the report starts there.
      name: "an expect wrapped over lines, reported where its statement starts",
      code: [
        'test("creates", async () => {',
        '  expect(await db.model(User).create({ email: "a" })).toBeDefined();',
        "  expect(",
        '    await db.model(Post).create({ title: "b" }),',
        "  ).toBeDefined();",
        "});",
      ].join("\n"),
      errors: [{ messageId: "secondModel", line: 3 }],
    },
  ],
});
