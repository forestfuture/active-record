/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Attribute aliases (#509): another name for an attribute, which reads, writes and queries it.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, type TableAttributes } from "../../packages/active-record/src/index.ts";
import { d1 } from "../../packages/active-record/src/adapters/d1/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// A generated schema, as `active-record schema` writes it, for Models built on it.
const users = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
  createdAt: "datetime",
  updatedAt: "datetime",
} as const;

const schema = {
  adapter: d1({ binding: "DB" }),
  tables: { users: { attributes: users, primaryKey: "id" } },
  models: { User: "users" },
} as const;

abstract class ApplicationRecord extends Model {
  static override schema = schema;
}

class User extends ApplicationRecord {
  static override attributes = {
    login: { aliasOf: "email" },
    years: { aliasOf: "age" },
  } as const;
}
interface User extends TableAttributes<typeof users, (typeof User)["attributes"]> {}

describe("an attribute alias", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  beforeEach(async () => {
    await harness.reset("posts", "users");
    events.length = 0;
  });

  describe("on a record", () => {
    test("reads its attribute's value", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'jane@example.com')");

      const user = await db().model(User).find(1);

      expect(user.login).toBe("jane@example.com");
    });

    test("writes its attribute, which a save stores", async () => {
      const user = db().model(User).build({ email: "jane@example.com" });

      user.login = "sam@example.com";
      await user.save();

      expect(user.email).toBe("sam@example.com");
      expect(await harness.exec("SELECT email FROM users")).toEqual([{ email: "sam@example.com" }]);
    });
  });
});
