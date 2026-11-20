/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Virtual attributes (#356): attributes that aren't columns, never read from a row or written to one.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, type TableAttributes } from "../../packages/active-record/src/index.ts";
import { d1 } from "../../packages/active-record/src/adapters/d1/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

// A generated schema, as `active-record schema` writes it, for Models built on it.
const users = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  createdAt: "datetime",
  updatedAt: "datetime",
} as const;
const samples = { id: { type: "integer", null: false }, label: "string" } as const;

const schema = {
  adapter: d1({ binding: "DB" }),
  tables: {
    users: { attributes: users, primaryKey: "id" },
    samples: { attributes: samples, primaryKey: "id" },
  },
  models: { User: "users", Sample: "samples" },
} as const;

abstract class ApplicationRecord extends Model {
  static override schema = schema;
}

class User extends ApplicationRecord {
  static override attributes = {
    nickname: { type: "string", virtual: true },
    termsOfService: { type: "boolean", virtual: true, default: () => false },
  } as const;
}
interface User extends TableAttributes<typeof users, (typeof User)["attributes"]> {}

describe("a virtual attribute", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  const bound = () => events.flatMap((event) => event.params);
  beforeEach(async () => {
    await harness.reset("posts", "users", "samples");
    events.length = 0;
  });

  describe("when saved", () => {
    test("isn't inserted", async () => {
      const user = await db()
        .model(User)
        .create({ email: "jane@example.com", nickname: "Janie", termsOfService: true });

      expect(user.isPersisted()).toBe(true);
      expect(bound()).not.toContain("Janie");
      expect(await harness.exec("SELECT email FROM users")).toEqual([
        { email: "jane@example.com" },
      ]);
    });

    test("isn't updated with the columns that changed", async () => {
      const user = await db().model(User).create({ email: "jane@example.com" });
      events.length = 0;

      await user.update({ role: "admin", nickname: "Janie" });

      expect(statementKinds(events)).toEqual(["UPDATE"]);
      expect(bound()).toContain("admin");
      expect(bound()).not.toContain("Janie");
    });
  });
});
