import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { MissingAttribute } from "../../src/index.ts";
import { User } from "../fixtures/models/user.ts";
import { openHarness, type Harness } from "../support/harness.ts";

describe("partial records", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec("INSERT INTO users (id, email, role) VALUES (1, 'a@example.com', 'admin')");
  });
  afterAll(() => harness.dispose());

  test("select loads only the chosen attributes, plus the primary key", async () => {
    const [user] = await harness.connect().model(User).select("email").toArray();

    expect(user?.email).toBe("a@example.com");
    expect(user?.id).toBe(1);
    expect(user?.attributes()).toEqual({ id: 1, email: "a@example.com" });
  });

  test("reading an attribute that wasn't selected throws MissingAttribute", async () => {
    const [user] = await harness.connect().model(User).select("email").toArray();

    expect(() => user?.role).toThrow(MissingAttribute);
    expect(() => user?.role).toThrow(/User.*"role".*select/);
  });

  test("setting an unloaded attribute loads it", async () => {
    const [user] = await harness.connect().model(User).select("email").toArray();

    if (user) user.role = "member";

    expect(user?.role).toBe("member");
  });

  test("finders ignore select and load full records", async () => {
    const users = harness.connect().model(User).select("email");

    expect((await users.find(1)).role).toBe("admin");
    expect((await users.findBy({ id: 1 }))?.role).toBe("admin");
  });

  test("with distinct, only the selected attributes are loaded, so rows really are distinct", async () => {
    await harness.exec("INSERT INTO users (id, email, role) VALUES (2, 'b@example.com', 'admin')");
    const roles = harness.connect().model(User).select("role").distinct();

    const records = await roles.toArray();

    expect(records.map((record) => record.attributes())).toEqual([{ role: "admin" }]);
    expect(await roles.count()).toBe(records.length);
  });
});
