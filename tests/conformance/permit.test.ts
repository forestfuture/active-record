import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from "vite-plus/test";
import { Model, UnknownAttribute } from "../../packages/active-record/src/index.ts";
import { User } from "../fixtures/models/user.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// Untrusted input, as a request gives it: only the named attributes reach a record (#82).
describe("Model.permit", () => {
  let harness: Harness;
  const users = () => harness.connect().model(User);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.exec("DELETE FROM users");
  });

  test("keeps the named attributes and drops every other key", () => {
    const body = JSON.parse(
      '{"email":"ada@example.com","role":"admin","isActive":"on","token":"x"}',
    );

    expect(User.permit(body, "email", "isActive")).toEqual({
      email: "ada@example.com",
      isActive: true,
    });
  });

  test("leaves out a named attribute the input doesn't have, and keeps a null", () => {
    expect(User.permit({ role: null }, "email", "role")).toEqual({ role: null });
  });

  test("reads only the input's own keys, so __proto__ and inherited keys never get through", () => {
    const body = JSON.parse('{"__proto__":{"role":"admin"},"email":"ada@example.com"}');

    expect(User.permit(body, "email", "role")).toEqual({ email: "ada@example.com" });
    expect(User.permit(Object.assign(Object.create(null), { role: "x" }), "role")).toEqual({
      role: "x",
    });
    expect(Object.getPrototypeOf(User.permit(body, "email"))).toBe(Object.prototype);
  });

  test("a name that isn't an attribute is UnknownAttribute", () => {
    expect(() => User.permit({}, "password" as never)).toThrow(
      new UnknownAttribute('User has no attribute "password"'),
    );
  });

  test("its result is typed as the named attributes, and goes straight into create", async () => {
    const body: unknown = JSON.parse(
      '{"email":"ada@example.com","isActive":"false","role":"admin"}',
    );
    const permitted = User.permit(body, "email", "isActive");
    expectTypeOf(permitted).toEqualTypeOf<{ email?: string; isActive?: boolean }>();

    const user = await users().create(permitted);

    expect([user.email, user.isActive, user.role]).toEqual(["ada@example.com", false, null]);
  });

  test("subclasses and an app's base class have it", () => {
    class Admin extends User {}
    abstract class Base extends Model {}
    class Member extends Base.define({ id: "integer", role: "string" }) {}

    expect(Admin.permit({ role: "x", age: 3 }, "role")).toEqual({ role: "x" });
    expect(Member.permit({ role: "x", id: 3 }, "role")).toEqual({ role: "x" });
  });

  test("a name that isn't an attribute is a compile error", () => {
    // @ts-expect-error: "password" isn't an attribute of User
    expect(() => User.permit({}, "password")).toThrow(UnknownAttribute);
  });

  test("reads FormData and URLSearchParams; a repeated key takes its last value, as in Rails", async () => {
    const form = new FormData();
    form.append("email", "ada@example.com");
    form.append("isActive", "on");
    form.append("role", "admin");
    const query = new URLSearchParams("age=30&age=31&role=admin");

    expect(User.permit(form, "email", "isActive")).toEqual({
      email: "ada@example.com",
      isActive: true,
    });
    expect(User.permit(query, "age")).toEqual({ age: 31 });

    const user = await users().create(User.permit(form, "email", "isActive"));
    expect(user.isActive).toBe(true);
  });

  test.each([
    [null],
    [undefined],
    ["email=x"],
    [42],
    [["email"]],
    [new Map([["email", "x"]])],
    [new Headers({ email: "x" })],
    [new Date(0)],
    [Object.create({ role: "admin" })], // its keys are inherited
  ])("%j isn't input it can read: TypeError", (input: unknown) => {
    expect(() => User.permit(input, "email")).toThrow(
      new TypeError("User.permit() takes an object, FormData or URLSearchParams"),
    );
  });

  // Its type says the values are the attributes' types, so they are: reading the result before
  // assigning it can't see "false" where TypeScript promises a boolean.
  test("casts each value as assigning it would, so the result is what its type says", () => {
    const permitted = User.permit(
      JSON.parse('{"isActive":"false","age":" 30 "}'),
      "isActive",
      "age",
    );

    expect(permitted).toEqual({ isActive: false, age: 30 });
    expect(permitted.isActive ? "grants" : "doesn't").toBe("doesn't");
  });

  test("a value that can't be cast is a TypeError, as when assigning it", () => {
    expect(() => User.permit({ isActive: "no" }, "isActive")).toThrow(
      new TypeError('User: "no" isn\'t a boolean for "isActive"'),
    );
  });

  test("a file from a form is a TypeError: no attribute stores one", () => {
    const form = new FormData();
    form.append("email", new File(["x"], "x.txt"));

    expect(() => User.permit(form, "email")).toThrow(
      new TypeError('User: "email" is a file, and no attribute stores one'),
    );
  });
});
