import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
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
