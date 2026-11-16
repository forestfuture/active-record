import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  ActiveRecordError,
  hasMany,
  Model,
  RecordInvalid,
  StrictValidationFailed,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.validates("email", { presence: true, unless: (user) => user.role === "guest" });
    this.validates("role", {
      length: { minimum: 4 },
      if: (user) => user.email !== null,
      unless: (user) => user.email === "root@example.com",
    });
  }
}

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  bio: "string",
}) {
  static table = "profiles";

  static {
    this.validates("bio", { length: { minimum: 10 }, allowBlank: true });
  }
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  static {
    this.validates("body", { length: { minimum: 10 }, allowNull: true });
  }
}

let harness: Harness;

beforeAll(async () => {
  harness = await openHarness();
});
afterAll(() => harness.dispose());
beforeEach(() => harness.reset("posts", "users"));

describe("unless", () => {
  test("skips the rules when it returns true", async () => {
    const users = harness.connect().model(User);

    expect(await users.build({ role: "guest" }).isValid()).toBe(true);
    const member = users.build({ role: "member" });
    expect(await member.isValid()).toBe(false);
    expect(member.errors.get("email")).toEqual(["can't be blank"]);
  });

  test("with if, runs the rules only when if holds and unless doesn't", async () => {
    const users = harness.connect().model(User);
    const roleErrors = async (email: string | null) => {
      const user = users.build({ email, role: "x" });
      await user.isValid();
      return user.errors.get("role");
    };

    expect(await roleErrors("a@example.com")).toEqual(["is too short (minimum is 4 characters)"]);
    expect(await roleErrors("root@example.com")).toEqual([]);
    expect(await roleErrors(null)).toEqual([]);
  });
});

describe("allowBlank and allowNull", () => {
  test("allowBlank skips null and a string that's only whitespace", async () => {
    const profiles = harness.connect().model(Profile);

    expect(await profiles.build({ bio: null }).isValid()).toBe(true);
    expect(await profiles.build({ bio: "  " }).isValid()).toBe(true);
    expect(await profiles.build({ bio: "short" }).isValid()).toBe(false);
  });

  test("allowNull skips only null", async () => {
    const comments = harness.connect().model(Comment);

    expect(await comments.build({ body: null }).isValid()).toBe(true);
    const blank = comments.build({ body: "  " });
    expect(await blank.isValid()).toBe(false);
    expect(blank.errors.get("body")).toEqual(["is too short (minimum is 10 characters)"]);
  });
});

/** A user whose email is checked strictly, and whose role is checked after it. */
class StrictUser extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";
  static readonly log: string[] = [];

  static {
    this.validates("email", { presence: true, strict: true });
    this.validates("role", { presence: true });
    this.afterValidation(() => void StrictUser.log.push("afterValidation"));
  }
}

describe("strict", () => {
  test("isValid throws StrictValidationFailed with the full message, and runs nothing after it", async () => {
    StrictUser.log.length = 0;
    const user = harness.connect().model(StrictUser).build();

    const error = await user.isValid().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StrictValidationFailed);
    expect(error).toBeInstanceOf(ActiveRecordError);
    expect((error as Error).message).toBe("Email can't be blank");
    expect(user.errors.isEmpty()).toBe(true);
    expect(StrictUser.log).toEqual([]);
  });

  test("save and saveOrThrow throw StrictValidationFailed and send no statement", async () => {
    const queries: QueryEvent[] = [];
    const users = harness.connect({ onQuery: (event) => queries.push(event) }).model(StrictUser);

    await expect(users.build().save()).rejects.toThrow(StrictValidationFailed);
    const error = await users
      .build()
      .saveOrThrow()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StrictValidationFailed);
    expect(error).not.toBeInstanceOf(RecordInvalid);
    expect(queries).toHaveLength(0);
  });

  test("a rule that passes adds the other rules' errors as usual", async () => {
    const user = harness.connect().model(StrictUser).build({ email: "a@example.com" });

    expect(await user.isValid()).toBe(false);
    expect(user.errors.fullMessages()).toEqual(["Role can't be blank"]);
  });
});

describe("strict with an Error class", () => {
  class MissingTenant extends Error {}

  class Tenanted extends Model.define({
    id: { type: "integer", null: false },
    email: "string",
    role: "string",
  }) {
    static table = "users";

    static {
      this.validates("role", { presence: true, strict: MissingTenant });
    }
  }

  test("throws that class with the full message", async () => {
    const error = await harness
      .connect()
      .model(Tenanted)
      .build()
      .isValid()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MissingTenant);
    expect((error as Error).message).toBe("Role can't be blank");
  });
});

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  static {
    this.validates("title", { presence: true });
  }
}

class Author extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });

  static {
    this.validatesAssociated("posts");
  }
}

/** Seeds an author with a post of each title, and reads the author back. */
async function seedAuthor(titles: readonly string[]) {
  await harness.exec("INSERT INTO users (id, email) VALUES (?, ?)", [1, "a@example.com"]);
  for (const [index, title] of titles.entries()) {
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (?, ?, ?)", [
      index + 1,
      1,
      title,
    ]);
  }
  return harness.connect().model(Author).find(1);
}

describe("validatesAssociated on a hasMany", () => {
  test("an invalid loaded record makes its owner invalid", async () => {
    const author = await seedAuthor(["Hello", " "]);
    await author.posts().toArray();

    expect(await author.isValid()).toBe(false);
    expect(author.errors.fullMessages()).toEqual(["Posts is invalid"]);
  });

  test("an owner whose loaded records are valid is valid", async () => {
    const author = await seedAuthor(["Hello", "World"]);
    await author.posts().toArray();

    expect(await author.isValid()).toBe(true);
  });

  test("a record marked for destruction isn't validated", async () => {
    const author = await seedAuthor(["Hello", " "]);
    const [, blank] = await author.posts().toArray();
    blank!.markForDestruction();

    expect(await author.isValid()).toBe(true);
  });
});
