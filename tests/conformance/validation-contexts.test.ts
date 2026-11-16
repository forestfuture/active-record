import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  Model,
  RecordInvalid,
} from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.validates("role", { presence: true, on: "create" });
  }
}

class Member extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.validates("role", { presence: true, on: "update" });
    this.validates("email", { length: { minimum: 6 }, on: ["create", "update"] });
  }
}

class Guest extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.validates("role", { presence: true, exceptOn: "create" });
  }
}

class Applicant extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.validates("email", { presence: true });
    this.validates("role", { presence: true, on: "signup" });
    this.validates("role", { length: { minimum: 4 }, on: "create" });
    this.validates("role", { exclusion: ["root"], on: "invite" });
  }
}

/** The validation callbacks each `Visitor` ran, in order. */
const ran: string[] = [];

class Visitor extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.beforeValidation(() => ran.push("before on create"), { on: "create" });
    this.beforeValidation(() => ran.push("before"));
    this.afterValidation(() => ran.push("after on update or signup"), { on: ["update", "signup"] });
  }
}

class Article extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  static {
    this.validates("title", { presence: true });
  }
}

class Writer extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  articles = hasMany(Article, { foreignKey: "userId" });

  static {
    this.validatesAssociated("articles", { on: "publish" });
  }
}

class Chapter extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  static {
    this.validates("title", { length: { minimum: 4 }, on: "publish" });
    this.validates("title", { exclusion: ["Draft"], on: "create" });
  }
}

class Novelist extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  chapters = hasMany(Chapter, { foreignKey: "userId" });

  static {
    this.validatesAssociated("chapters");
  }
}

class Staff extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: { type: "string", enum: ["admin", "member"], validate: true },
}) {
  static table = "users";

  static {
    this.validates("email", { uniqueness: true });
  }
}

class Entry extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  title: { type: "string", null: false },
}) {
  static table = "posts";

  author = belongsTo(Staff, { foreignKey: "userId" });
}

let harness: Harness;

beforeAll(async () => {
  harness = await openHarness();
});
afterAll(() => harness.dispose());
beforeEach(() => harness.reset("posts", "users"));

describe("on", () => {
  test('on: "create" runs the rules only while the record is new', async () => {
    const users = harness.connect().model(User);

    const user = users.build({ email: "a@example.com" });
    expect(await user.isValid()).toBe(false);
    expect(user.errors.get("role")).toEqual(["can't be blank"]);
    expect(await user.save()).toBe(false);

    await harness.exec("INSERT INTO users (id, email) VALUES (1, ?)", ["b@example.com"]);
    const saved = await users.find(1);
    expect(await saved.isValid()).toBe(true);
    expect(await saved.save()).toBe(true);
  });

  test('on: "update" runs the rules only once the record is saved', async () => {
    const members = harness.connect().model(Member);

    const member = members.build({ email: "a@example.com" });
    expect(await member.isValid()).toBe(true);
    expect(await member.save()).toBe(true);
    expect(await member.isValid()).toBe(false);
    expect(member.errors.get("role")).toEqual(["can't be blank"]);
    expect(await member.save()).toBe(false);
  });

  test("a list of contexts runs the rules in each of them", async () => {
    const members = harness.connect().model(Member);

    const member = members.build({ email: "a@b", role: "admin" });
    expect(await member.isValid()).toBe(false);
    member.email = "a@example.com";
    expect(await member.save()).toBe(true);
    member.email = "a@b";
    expect(await member.isValid()).toBe(false);
    expect(member.errors.get("email")).toEqual(["is too short (minimum is 6 characters)"]);
  });
});

describe("exceptOn", () => {
  test("skips the rules in that context and runs them in any other", async () => {
    const guests = harness.connect().model(Guest);

    const guest = guests.build({ email: "a@example.com" });
    expect(await guest.save()).toBe(true);
    expect(await guest.isValid()).toBe(false);
    expect(guest.errors.get("role")).toEqual(["can't be blank"]);
  });
});

describe("a context given to isValid", () => {
  test("runs its rules and those without on, in place of the record's own context", async () => {
    const applicants = harness.connect().model(Applicant);

    const applicant = applicants.build({});
    expect(await applicant.isValid("signup")).toBe(false);
    expect(applicant.errors.toArray().map(({ attribute, type }) => [attribute, type])).toEqual([
      ["email", "blank"],
      ["role", "blank"],
    ]);
  });

  test("a list runs the rules of each context in it", async () => {
    const applicants = harness.connect().model(Applicant);

    const applicant = applicants.build({ email: "a@example.com", role: "root" });
    expect(await applicant.isValid(["create", "invite"])).toBe(false);
    expect(applicant.errors.get("role")).toEqual(["is reserved"]);
    applicant.role = "ab";
    await applicant.isValid(["create", "invite"]);
    expect(applicant.errors.get("role")).toEqual(["is too short (minimum is 4 characters)"]);
  });
});

describe("a context given to save", () => {
  test("save validates in it", async () => {
    const applicants = harness.connect().model(Applicant);

    const applicant = applicants.build({ email: "a@example.com", role: "ab" });
    expect(await applicant.save({ context: "signup" })).toBe(true);
    applicant.role = null;
    expect(await applicant.save({ context: "signup" })).toBe(false);
    expect(applicant.errors.get("role")).toEqual(["can't be blank"]);
  });

  test("saveOrThrow validates in it", async () => {
    const applicants = harness.connect().model(Applicant);

    const applicant = applicants.build({ email: "a@example.com", role: "root" });
    await expect(applicant.saveOrThrow({ context: "invite" })).rejects.toThrow(RecordInvalid);
    applicant.role = "ab";
    await expect(applicant.saveOrThrow({ context: "invite" })).resolves.toBe(true);
  });
});

describe("validation callbacks with on", () => {
  test("run only in the contexts they name", async () => {
    const visitors = harness.connect().model(Visitor);
    ran.length = 0;

    const visitor = visitors.build({ email: "a@example.com" });
    await visitor.save();
    expect(ran.splice(0)).toEqual(["before on create", "before"]);
    await visitor.isValid();
    expect(ran.splice(0)).toEqual(["before", "after on update or signup"]);
    await visitors.build({}).isValid("signup");
    expect(ran.splice(0)).toEqual(["before", "after on update or signup"]);
  });
});

/** Seeds user 1 with a post of each title. */
async function seedPosts(titles: readonly string[]): Promise<void> {
  await harness.exec("INSERT INTO users (id, email) VALUES (?, ?)", [1, "a@example.com"]);
  for (const [index, title] of titles.entries()) {
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (?, ?, ?)", [
      index + 1,
      1,
      title,
    ]);
  }
}

describe("validatesAssociated with on", () => {
  test("validates the association only in the contexts it names", async () => {
    await seedPosts(["Hello", " "]);
    const writer = await harness.connect().model(Writer).find(1);
    await writer.articles().toArray();

    expect(await writer.isValid()).toBe(true);
    expect(await writer.isValid("publish")).toBe(false);
    expect(writer.errors.fullMessages()).toEqual(["Articles is invalid"]);
  });
});

describe("the context of associated records", () => {
  test("a custom context reaches the records validatesAssociated validates", async () => {
    await seedPosts(["Hi"]);
    const novelist = await harness.connect().model(Novelist).find(1);
    await novelist.chapters().toArray();

    expect(await novelist.isValid()).toBe(true);
    expect(await novelist.isValid("publish")).toBe(false);
    expect(novelist.errors.fullMessages()).toEqual(["Chapters is invalid"]);
  });

  test("a custom context reaches the records a save autosaves", async () => {
    const novelist = harness.connect().model(Novelist).build({ email: "a@example.com" });
    const chapter = novelist.chapters().build({ title: "Hi" });

    expect(await novelist.save({ context: "publish" })).toBe(false);
    expect(chapter.errors.get("title")).toEqual(["is too short (minimum is 4 characters)"]);
  });

  test('"update" or "create" given to the owner leaves each record its own', async () => {
    await seedPosts(["Draft"]);
    const novelist = await harness.connect().model(Novelist).find(1);
    const [loaded] = await novelist.chapters().toArray();
    const built = novelist.chapters().build({ title: "Draft" });

    expect(await novelist.isValid("update")).toBe(false);
    expect(built.errors.get("title")).toEqual(["is reserved"]);
    expect(loaded!.errors.isEmpty()).toBe(true);
  });
});

describe("checks that run in every context", () => {
  test("an enum's validate: true and uniqueness run in a custom context", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (1, ?)", ["a@example.com"]);
    const staff = harness.connect().model(Staff);

    const member = staff.build({ email: "a@example.com", role: "guest" as never });
    expect(await member.isValid("signup")).toBe(false);
    expect(member.errors.toArray().map(({ attribute, type }) => [attribute, type])).toEqual([
      ["role", "inclusion"],
      ["email", "taken"],
    ]);
  });

  test("a required belongsTo runs in a custom context", async () => {
    const entry = harness.connect().model(Entry).build({ title: "Hello" });

    expect(await entry.isValid("publish")).toBe(false);
    expect(entry.errors.fullMessages()).toEqual(["Author must exist"]);
  });
});
