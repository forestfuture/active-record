/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Secure passwords (#355): a virtual password, kept in the table only as its digest.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from "vite-plus/test";
import { Model, type TableAttributes } from "../../packages/active-record/src/index.ts";
import { d1 } from "../../packages/active-record/src/adapters/d1/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// A generated schema, as `active-record schema` writes it, for Models built on it.
const members = {
  id: { type: "integer", null: false },
  email: "string",
  passwordDigest: "string",
  recoveryPasswordDigest: "string",
  authToken: "string",
  inviteCode: "string",
  updatedAt: "datetime",
} as const;

const schema = {
  adapter: d1({ binding: "DB" }),
  tables: { members: { attributes: members, primaryKey: "id" } },
  models: { Member: "members" },
} as const;

abstract class ApplicationRecord extends Model {
  static override schema = schema;
}

class Member extends ApplicationRecord {
  static override attributes = { password: { securePassword: true } } as const;
}
interface Member extends TableAttributes<typeof members, (typeof Member)["attributes"]> {}

describe("a secure password", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  const bound = () => events.flatMap((event) => event.params);
  const storedDigest = async () =>
    (await harness.exec("SELECT password_digest FROM members"))[0]?.password_digest;
  beforeEach(async () => {
    await harness.reset("members");
    events.length = 0;
  });

  describe("when saved", () => {
    test("is kept as its digest, never as itself", async () => {
      const member = await db()
        .model(Member)
        .create({ email: "jane@example.com", password: "correct horse" });

      const digest = await storedDigest();
      expect(digest).toMatch(/^\$pbkdf2-sha256\$/);
      expect(member.passwordDigest).toBe(digest);
      expect(bound()).not.toContain("correct horse");
      expect(JSON.stringify(await harness.exec("SELECT * FROM members"))).not.toContain(
        "correct horse",
      );
    });
  });

  describe("authenticate", () => {
    test("resolves to the record for its password, and false for any other", async () => {
      await db().model(Member).create({ email: "jane@example.com", password: "correct horse" });
      const member = await db().model(Member).findByOrThrow({ email: "jane@example.com" });

      const authenticated = await member.authenticate("correct horse");

      expectTypeOf(authenticated).toEqualTypeOf<Member | false>();
      expect(authenticated).toBe(member);
      expect(await member.authenticate("correct horse!")).toBe(false);
      expect(await member.authenticatePassword("correct horse")).toBe(member);
    });

    test("is false without a digest", async () => {
      const member = db().model(Member).build({ email: "jane@example.com" });

      expect(member.passwordDigest).toBe(null);
      expect(await member.authenticate("")).toBe(false);
    });

    test("reads the digest as it is, so a password assigned since isn't checked yet", async () => {
      const member = await db()
        .model(Member)
        .create({ email: "jane@example.com", password: "correct horse" });

      member.password = "battery staple";

      expect(await member.authenticate("battery staple")).toBe(false);
      expect(await member.authenticate("correct horse")).toBe(member);
      await member.saveOrThrow();
      expect(await member.authenticate("battery staple")).toBe(member);
    });
  });

  describe("assigned", () => {
    test("null clears the digest", async () => {
      const member = await db()
        .model(Member)
        .create({ email: "jane@example.com", password: "correct horse" });

      member.password = null;

      expect(member.passwordDigest).toBe(null);
      expect(member.isAttributeChanged("passwordDigest")).toBe(true);
    });

    test("an empty string is ignored", async () => {
      const member = await db()
        .model(Member)
        .create({ email: "jane@example.com", password: "correct horse" });
      const digest = member.passwordDigest;

      member.password = "";
      member.assign({ password: "" });

      expect(member.password).toBe("correct horse");
      expect(member.passwordDigest).toBe(digest);
      expect(member.isChanged()).toBe(false);
    });
  });
});
