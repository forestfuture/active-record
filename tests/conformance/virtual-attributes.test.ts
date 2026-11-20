/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Virtual attributes (#356): attributes that aren't columns, never read from a row or written to one.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  Model,
  UnknownAttribute,
  type TableAttributes,
} from "../../packages/active-record/src/index.ts";
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
  models: { User: "users", Sample: "samples", Member: "users", Account: "users" },
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

// Ignoring a column, so its queries name their columns instead of `*`.
class Member extends ApplicationRecord {
  static override table = "users";
  static override attributes = {
    role: false,
    nickname: { type: "string", virtual: true },
  } as const;
}
interface Member extends TableAttributes<typeof users, (typeof Member)["attributes"]> {}

class Sample extends ApplicationRecord {
  static override attributes = { note: { type: "string", virtual: true } } as const;
}
interface Sample extends TableAttributes<typeof samples, (typeof Sample)["attributes"]> {}

// Confirming its email, with a virtual attribute for the confirmation.
class Account extends ApplicationRecord {
  static override table = "users";
  static override attributes = {
    nickname: { type: "string", virtual: true },
    emailConfirmation: { type: "string", virtual: true },
  } as const;
  static {
    this.validates("email", { confirmation: true });
  }
}
interface Account extends TableAttributes<typeof users, (typeof Account)["attributes"]> {}

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

  describe("its changes", () => {
    test("are saved with the record's, and it keeps its value", async () => {
      const user = await db()
        .model(User)
        .create({ email: "jane@example.com", termsOfService: true });

      expect(user.termsOfService).toBe(true);
      expect(user.changes()).toEqual({});
      expect(user.savedChanges()).toMatchObject({ termsOfService: [false, true] });
    });

    test("alone, save updates only updatedAt, as Rails does", async () => {
      const user = await db().model(User).create({ email: "jane@example.com" });
      const before = user.updatedAt;
      events.length = 0;

      user.nickname = "Janie";
      await user.save();

      expect(statementKinds(events)).toEqual(["UPDATE"]);
      expect(bound()).not.toContain("Janie");
      expect(user.updatedAt).not.toEqual(before);
      expect(user.changes()).toEqual({});
      expect(user.savedChanges()).toMatchObject({ nickname: [null, "Janie"] });
    });

    test("alone, on a table with no timestamps, save sends nothing", async () => {
      const sample = await db().model(Sample).create({ label: "a" });
      events.length = 0;

      sample.note = "checked";
      await sample.save();

      expect(events).toEqual([]);
      expect(sample.changes()).toEqual({});
      expect(sample.savedChanges()).toEqual({ note: [null, "checked"] });
    });
  });

  describe("on a loaded record", () => {
    test("starts at its default, or null, unchanged", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'jane@example.com')");

      const user = await db().model(User).find(1);

      expect(user.termsOfService).toBe(false);
      expect(user.nickname).toBeNull();
      expect(user.changes()).toEqual({});
    });

    test("loads on a Model that names its columns", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'jane@example.com')");

      const member = await db().model(Member).find(1);

      expect(member.nickname).toBeNull();
    });

    test("goes back to its default on reload, as Rails does", async () => {
      const user = await db()
        .model(User)
        .create({ email: "jane@example.com", nickname: "Janie", termsOfService: true });

      await user.reload();

      expect(user.termsOfService).toBe(false);
      expect(user.nickname).toBeNull();
      expect(user.changes()).toEqual({});
    });
  });

  describe("in JSON", () => {
    test("is sent, but a confirmation isn't, as Rails sends neither confirmation", async () => {
      const account = await db().model(Account).create({
        email: "jane@example.com",
        emailConfirmation: "jane@example.com",
        nickname: "Janie",
      });

      expect(account.toJSON()).toMatchObject({ nickname: "Janie" });
      expect(account.toJSON()).not.toHaveProperty("emailConfirmation");
      expect(account.attributes()).toMatchObject({ emailConfirmation: "jane@example.com" });
    });
  });

  describe("in a query", () => {
    const refusal = new UnknownAttribute(
      "User.nickname is a virtual attribute, which has no column to query",
    );

    test("is refused when the query is written, before anything is sent", async () => {
      const users = db().model(User);

      expect(() => users.where({ nickname: "Janie" })).toThrow(refusal);
      expect(() => users.order({ nickname: "asc" })).toThrow(refusal);
      expect(() => users.select("nickname")).toThrow(refusal);
      await expect(users.pluck("nickname")).rejects.toThrow(refusal);
      await expect(users.findBy({ nickname: "Janie" })).rejects.toThrow(refusal);
      await expect(
        users.findOrCreateBy({ email: "jane@example.com", nickname: "Janie" }),
      ).rejects.toThrow(refusal);
      expect(events).toEqual([]);
    });

    test("is refused in a bulk insert or update", async () => {
      const users = db().model(User);

      await expect(users.insert({ email: "jane@example.com", nickname: "Janie" })).rejects.toThrow(
        refusal,
      );
      await expect(users.updateAll({ nickname: "Janie" })).rejects.toThrow(refusal);
      expect(events).toEqual([]);
    });
  });
});
