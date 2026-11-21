/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Secure tokens (#355): a random token, generated for a new record, and regenerated on request.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  Model,
  RecordInvalid,
  type TableAttributes,
} from "../../packages/active-record/src/index.ts";
import { d1 } from "../../packages/active-record/src/adapters/d1/index.ts";
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
  static override attributes = {
    authToken: { secureToken: true },
    inviteCode: { secureToken: { length: 32, prefix: "invite_", on: "create" } },
  } as const;

  static {
    this.validates("email", { presence: true });
  }
}
interface Member extends TableAttributes<typeof members, (typeof Member)["attributes"]> {}

/** Base58: digits and letters, without 0, O, I and l, which read alike. */
const base58 = (length: number) => new RegExp(`^[1-9A-HJ-NP-Za-km-z]{${length}}$`);

describe("a secure token", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const db = () => harness.connect();
  const stored = async () => (await harness.exec("SELECT auth_token, invite_code FROM members"))[0];
  beforeEach(async () => {
    await harness.reset("members");
  });

  describe("when a record is built", () => {
    test("is generated: 24 characters of base58", () => {
      const member = db().model(Member).build({ email: "jane@example.com" });

      expect(member.authToken).toMatch(base58(24));
    });

    test("differs from record to record", () => {
      const tokens = Array.from(
        { length: 20 },
        () => db().model(Member).build({ email: "jane@example.com" }).authToken,
      );

      expect(new Set(tokens).size).toBe(20);
    });

    test("is saved with it", async () => {
      const member = await db().model(Member).create({ email: "jane@example.com" });

      expect((await stored())?.auth_token).toBe(member.authToken);
    });

    test("isn't generated when one is given", () => {
      const member = db().model(Member).build({ email: "jane@example.com", authToken: "given" });

      expect(member.authToken).toBe("given");
    });
  });

  describe("on create", () => {
    test("is generated as the record is created, with its prefix and length", async () => {
      const member = db().model(Member).build({ email: "jane@example.com" });
      expect(member.inviteCode).toBe(null);

      await member.saveOrThrow();

      expect(member.inviteCode).toMatch(/^invite_/);
      expect(member.inviteCode?.slice("invite_".length)).toMatch(base58(32));
      expect((await stored())?.invite_code).toBe(member.inviteCode);
    });

    test("isn't generated for a record loaded without one", async () => {
      await harness.exec("INSERT INTO members (id, email) VALUES (1, 'jane@example.com')");

      const member = await db().model(Member).find(1);
      await member.update({ email: "sam@example.com" });

      expect(member.authToken).toBe(null);
      expect(member.inviteCode).toBe(null);
    });
  });

  describe("regenerating it", () => {
    test("saves a new one", async () => {
      const member = await db().model(Member).create({ email: "jane@example.com" });
      const before = member.authToken;

      expect(await member.regenerateAuthToken()).toBe(true);

      expect(member.authToken).toMatch(base58(24));
      expect(member.authToken).not.toBe(before);
      expect((await stored())?.auth_token).toBe(member.authToken);
    });

    test("keeps its prefix and length", async () => {
      const member = await db().model(Member).create({ email: "jane@example.com" });

      await member.regenerateInviteCodeOrThrow();

      expect(member.inviteCode?.slice("invite_".length)).toMatch(base58(32));
    });

    test("is false for an invalid record, and its OrThrow throws", async () => {
      const member = await db().model(Member).create({ email: "jane@example.com" });
      const saved = (await stored())?.auth_token;
      member.email = null;

      expect(await member.regenerateAuthToken()).toBe(false);
      await expect(member.regenerateAuthTokenOrThrow()).rejects.toThrow(RecordInvalid);
      expect((await stored())?.auth_token).toBe(saved);
    });
  });
});
