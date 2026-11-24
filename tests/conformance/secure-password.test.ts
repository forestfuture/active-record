/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Secure passwords (#355): a virtual password, kept in the table only as its digest.
import { inspect } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
  vi,
} from "vite-plus/test";
import {
  InvalidModel,
  InvalidToken,
  Model,
  RecordNotFound,
  withDatabase,
  type TableAttributes,
} from "../../packages/active-record/src/index.ts";
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
  models: { Member: "members", Guest: "members" },
} as const;

abstract class ApplicationRecord extends Model {
  static override schema = schema;
  static override signingSecret() {
    return "a-signing-secret-of-at-least-32-bytes";
  }
}

class Member extends ApplicationRecord {
  static override attributes = { password: { securePassword: true } } as const;
}
interface Member extends TableAttributes<typeof members, (typeof Member)["attributes"]> {}

// Its password left unvalidated.
class Guest extends ApplicationRecord {
  static override table = "members";
  static override attributes = { password: { securePassword: { validations: false } } } as const;
}
interface Guest extends TableAttributes<typeof members, (typeof Guest)["attributes"]> {}

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

  describe("filtered", () => {
    // Filtering nothing by name, so only being a secure password or token filters a value.
    class Visible extends Model.define({
      id: { type: "integer", null: false },
      recoveryPasswordDigest: "string",
      inviteCode: { type: "string", secureToken: true },
      recoveryPassword: { securePassword: { validations: false } },
    }) {
      static table = "members";
      static override filterAttributes = [];
    }

    test("its digest, and a secure token, are filtered in onQuery whatever filterAttributes says", async () => {
      const visible = await db().model(Visible).create({ recoveryPassword: "correct horse" });

      expect(bound()).not.toContain(visible.recoveryPasswordDigest);
      expect(bound()).not.toContain(visible.inviteCode);
      expect(bound().filter((value) => value === "[FILTERED]")).toHaveLength(2);
    });

    test("it, its confirmation and its challenge print as [FILTERED]", () => {
      const visible = db().model(Visible).build({
        recoveryPassword: "correct horse",
        recoveryPasswordConfirmation: "correct horse",
        recoveryPasswordChallenge: "battery staple",
      });

      const printed = inspect(visible);

      expect(printed).not.toContain("correct horse");
      expect(printed).not.toContain("battery staple");
      expect(printed).not.toContain(visible.inviteCode);
    });
  });

  describe("assigned in a callback", () => {
    /** A Model whose algorithm records each password it hashes, and whose beforeSave may set one. */
    const callbackModel = (hashed: string[], assigned?: string) =>
      class Callback extends Model.define({
        id: { type: "integer", null: false },
        passwordDigest: "string",
        password: {
          securePassword: {
            algorithm: {
              hash: async (password: string) => {
                hashed.push(password);
                return `plain:${password}`;
              },
              verify: async (password: string, digest: string) => digest === `plain:${password}`,
            },
          },
        },
      }) {
        static table = "members";

        static {
          this.beforeSave((record) => {
            if (assigned !== undefined) record.password = assigned;
          });
        }
      };

    test("is hashed, when beforeSave assigns it", async () => {
      const hashed: string[] = [];
      const Callback = callbackModel(hashed, "from beforeSave");

      const record = await db().model(Callback).create({ password: "correct horse" });

      expect(hashed).toEqual(["correct horse", "from beforeSave"]);
      expect(await record.authenticate("from beforeSave")).toBe(record);
    });

    test("isn't hashed twice when no callback changes it", async () => {
      const hashed: string[] = [];
      const Callback = callbackModel(hashed);

      await db().model(Callback).create({ password: "correct horse" });

      expect(hashed).toEqual(["correct horse"]);
    });
  });

  describe("saved in a batch", () => {
    test("is hashed as the record's own save hashes it", async () => {
      const database = db();
      const member = database.model(Member).build({ password: "correct horse" });

      await database.batch((b) => [b.save(member)]);

      expect(await storedDigest()).toMatch(/^\$pbkdf2-sha256\$/);
      expect(await member.authenticate("correct horse")).toBe(member);
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

    test("is false for a value that isn't a string", async () => {
      const member = await db()
        .model(Member)
        .create({ email: "jane@example.com", password: "correct horse" });

      expect(await member.authenticate(["correct horse"] as never)).toBe(false);
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

    test("assigned again after null clears the digest, is hashed again", async () => {
      const member = await db()
        .model(Member)
        .create({ email: "jane@example.com", password: "correct horse" });
      member.password = null;
      member.password = "correct horse";

      expect(await member.save()).toBe(true);
      expect(await member.authenticate("correct horse")).toBe(member);
    });

    test("a digest cleared directly isn't made again from the password kept in memory", async () => {
      const member = await db()
        .model(Member)
        .create({ email: "jane@example.com", password: "correct horse" });
      const digest = await storedDigest();

      expect(await member.update({ passwordDigest: null })).toBe(false);
      expect(member.errors.get("password")).toEqual(["can't be blank"]);
      expect(await storedDigest()).toBe(digest);
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

  describe("its validations", () => {
    test("make it required while there's no digest", async () => {
      const member = await db().model(Member).create({ email: "jane@example.com" });

      expect(member.isPersisted()).toBe(false);
      expect(member.errors.toArray()).toEqual([
        { attribute: "password", type: "blank", message: "can't be blank" },
      ]);
    });

    test("pass with a digest, without the password", async () => {
      await db().model(Member).create({ email: "jane@example.com", password: "correct horse" });
      const member = await db().model(Member).findByOrThrow({ email: "jane@example.com" });

      expect(await member.update({ email: "sam@example.com" })).toBe(true);
    });

    test("fail once null has cleared the digest", async () => {
      const member = await db()
        .model(Member)
        .create({ email: "jane@example.com", password: "correct horse" });

      member.password = null;

      expect(await member.save()).toBe(false);
      expect(member.errors.get("password")).toEqual(["can't be blank"]);
    });

    test("allow at most 72 bytes, counted in UTF-8", async () => {
      const members = db().model(Member);

      expect((await members.create({ password: "a".repeat(72) })).isPersisted()).toBe(true);
      const tooLong = await members.create({ password: "é".repeat(37) });

      expect(tooLong.isPersisted()).toBe(false);
      expect(tooLong.errors.toArray()).toEqual([
        { attribute: "password", type: "passwordTooLong", message: "is too long" },
      ]);
    });

    test("need a confirmation given to match", async () => {
      const members = db().model(Member);

      const mismatched = await members.create({
        password: "correct horse",
        passwordConfirmation: "correct house",
      });

      expect(mismatched.errors.toArray()).toEqual([
        {
          attribute: "passwordConfirmation",
          type: "confirmation",
          message: "doesn't match Password",
          values: { attribute: "Password" },
        },
      ]);
      const matched = await members.create({
        password: "correct horse",
        passwordConfirmation: "correct horse",
      });
      expect(matched.isPersisted()).toBe(true);
    });

    test("are left out with validations: false", async () => {
      const guest = await db().model(Guest).create({ email: "jane@example.com" });

      expect(guest.isPersisted()).toBe(true);
      expect(guest.passwordDigest).toBe(null);
    });
  });

  describe("its challenge", () => {
    const signedUp = async () => {
      await db().model(Member).create({ email: "jane@example.com", password: "correct horse" });
      return db().model(Member).findByOrThrow({ email: "jane@example.com" });
    };

    test("lets a password change when it's the current password", async () => {
      const member = await signedUp();

      const isUpdated = await member.update({
        password: "battery staple",
        passwordChallenge: "correct horse",
      });

      expect(isUpdated).toBe(true);
      expect(await member.authenticate("battery staple")).toBe(member);
    });

    test("refuses the change when it isn't", async () => {
      const member = await signedUp();
      const digest = await storedDigest();

      const isUpdated = await member.update({
        password: "battery staple",
        passwordChallenge: "battery staple",
      });

      expect(isUpdated).toBe(false);
      expect(member.errors.toArray()).toEqual([
        { attribute: "passwordChallenge", type: "invalid", message: "is invalid" },
      ]);
      expect(await storedDigest()).toBe(digest);
    });

    test("is checked against the digest as it was saved, even once null cleared it", async () => {
      const member = await signedUp();
      member.password = null;
      member.passwordChallenge = "correct horse";

      expect(await member.isValid()).toBe(false);
      expect(member.errors.get("passwordChallenge")).toEqual([]);
      expect(member.errors.get("password")).toEqual(["can't be blank"]);
    });

    test("fails on a record with no digest saved", async () => {
      const member = db()
        .model(Member)
        .build({ password: "correct horse", passwordChallenge: "correct horse" });

      expect(await member.isValid()).toBe(false);
      expect(member.errors.get("passwordChallenge")).toEqual(["is invalid"]);
    });
  });

  describe("as JSON", () => {
    test("leaves out the password, its confirmation and its challenge", async () => {
      const member = await db().model(Member).create({
        email: "jane@example.com",
        password: "correct horse",
        passwordConfirmation: "correct horse",
      });
      member.passwordChallenge = "correct horse";

      expect(member.isPersisted()).toBe(true);
      expect(Object.keys(member.toJSON())).not.toContain("password");
      expect(Object.keys(member.toJSON())).not.toContain("passwordConfirmation");
      expect(Object.keys(member.toJSON())).not.toContain("passwordChallenge");
      expect(JSON.stringify(member)).not.toContain("correct horse");
      expect(member.attributes()).toHaveProperty("password", "correct horse");
    });

    test("leaves out the digest, which attributes() keeps", async () => {
      const member = await db()
        .model(Member)
        .create({ email: "jane@example.com", password: "correct horse" });

      expect(Object.keys(member.toJSON())).not.toContain("passwordDigest");
      expect(member.attributes()).toHaveProperty("passwordDigest", member.passwordDigest);
    });
  });

  describe("authenticateBy", () => {
    // Declared with define, so its statics find whichever database withDatabase is given.
    class Login extends Model.define({
      id: { type: "integer", null: false },
      email: "string",
      passwordDigest: "string",
      password: { securePassword: true },
    }) {
      static table = "members";

      static {
        this.normalizes("email", { with: (email) => email.trim().toLowerCase() });
      }
    }

    const signIn = (attributes: { email?: string; password?: string | null }) =>
      withDatabase(db(), () => Login.authenticateBy(attributes));

    beforeEach(async () => {
      await db().model(Login).create({ email: "jane@example.com", password: "correct horse" });
      events.length = 0;
    });

    test("finds the record by the other attributes, and checks its password", async () => {
      const login = await signIn({ email: " Jane@Example.com", password: "correct horse" });

      expect(login).toBeInstanceOf(Login);
      expect(login?.email).toBe("jane@example.com");
      expect(await signIn({ email: "jane@example.com", password: "correct house" })).toBe(null);
    });

    test("finds only the records its default scope lets it", async () => {
      class ActiveLogin extends Model.define({
        id: { type: "integer", null: false },
        email: "string",
        passwordDigest: "string",
        password: { securePassword: true },
      }) {
        static table = "members";

        static {
          this.defaultScope((q) => q.whereNot({ email: "jane@example.com" }));
        }
      }

      const found = await withDatabase(db(), () =>
        ActiveLogin.authenticateBy({ email: "jane@example.com", password: "correct horse" }),
      );

      expect(found).toBe(null);
    });

    test("is null when no record matches", async () => {
      expect(await signIn({ email: "sam@example.com", password: "correct horse" })).toBe(null);
    });

    test("is null for a blank password, without a query", async () => {
      expect(await signIn({ email: "jane@example.com", password: "" })).toBe(null);
      expect(await signIn({ email: "jane@example.com", password: null })).toBe(null);
      expect(events).toEqual([]);
    });

    test("throws without a password, or without an attribute to find by", async () => {
      await expect(signIn({ email: "jane@example.com" })).rejects.toThrow(
        new TypeError("Login.authenticateBy needs a secure password: password"),
      );
      await expect(signIn({ password: "correct horse" })).rejects.toThrow(
        new TypeError("Login.authenticateBy needs an attribute to find the record by"),
      );
    });

    /** A Model whose algorithm records each password it hashes. */
    const timedModel = (hashed: string[]) =>
      class Timed extends Model.define({
        id: { type: "integer", null: false },
        email: "string",
        passwordDigest: "string",
        password: {
          securePassword: {
            algorithm: {
              hash: async (password: string) => {
                hashed.push(password);
                return `plain:${password}`;
              },
              verify: async (password: string, digest: string) => digest === `plain:${password}`,
            },
          },
        },
      }) {
        static table = "members";
      };

    test("hashes the password when no record matches, so it takes as long", async () => {
      const hashed: string[] = [];
      const Timed = timedModel(hashed);

      const found = await withDatabase(db(), () =>
        Timed.authenticateBy({ email: "sam@example.com", password: "battery staple" }),
      );

      expect(found).toBe(null);
      expect(hashed).toEqual(["battery staple"]);
    });

    test("hashes the password when the record has no digest, so it takes as long", async () => {
      await harness.exec("INSERT INTO members (id, email) VALUES (2, 'sam@example.com')");
      const hashed: string[] = [];
      const Timed = timedModel(hashed);

      const found = await withDatabase(db(), () =>
        Timed.authenticateBy({ email: "sam@example.com", password: "battery staple" }),
      );

      expect(found).toBe(null);
      expect(hashed).toEqual(["battery staple"]);
    });
  });

  describe("its algorithm", () => {
    /** An algorithm of an app's own, which keeps a marked password, so a test can read it. */
    const marked = (maxBytes?: number) => ({
      hash: async (password: string) => `marked:${password.length}`,
      verify: async (password: string, digest: string) => digest === `marked:${password.length}`,
      ...(maxBytes === undefined ? {} : { maxBytes }),
    });

    test("hashes and verifies the password", async () => {
      class Custom extends Model.define({
        id: { type: "integer", null: false },
        passwordDigest: "string",
        password: { securePassword: { algorithm: marked() } },
      }) {
        static table = "members";
      }

      const custom = await db().model(Custom).create({ password: "correct horse" });

      expect(await storedDigest()).toBe("marked:13");
      expect(await custom.authenticate("horse correct")).toBe(custom);
      expect(await custom.authenticate("battery")).toBe(false);
    });

    test("sets the most bytes a password may be", async () => {
      class Short extends Model.define({
        id: { type: "integer", null: false },
        passwordDigest: "string",
        password: { securePassword: { algorithm: marked(8) } },
      }) {
        static table = "members";
      }

      const short = await db().model(Short).create({ password: "123456789" });

      expect(short.errors.get("password")).toEqual(["is too long"]);
    });

    test("without maxBytes, allows a password of any length", async () => {
      class Long extends Model.define({
        id: { type: "integer", null: false },
        passwordDigest: "string",
        password: { securePassword: { algorithm: marked() } },
      }) {
        static table = "members";
      }

      const long = await db()
        .model(Long)
        .create({ password: "a".repeat(500) });

      expect(long.isPersisted()).toBe(true);
    });
  });

  describe("its reset token", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const createMember = () =>
      db().model(Member).create({ email: "jane@example.com", password: "correct horse" });

    test("finds its record", async () => {
      const jane = await createMember();
      await db().model(Member).create({ email: "sam@example.com", password: "battery staple" });

      const found = await db()
        .model(Member)
        .findByTokenFor("passwordReset", await jane.passwordResetToken());

      expect(found?.email).toBe("jane@example.com");
    });

    test("is found from the Model's statics", async () => {
      // Declared with define, so its statics find whichever database withDatabase is given.
      class Resetting extends Model.define({
        id: { type: "integer", null: false },
        email: "string",
        passwordDigest: "string",
        password: { securePassword: true },
      }) {
        static table = "members";
        static override signingSecret() {
          return "a-signing-secret-of-at-least-32-bytes";
        }
      }
      const jane = await db()
        .model(Resetting)
        .create({ email: "jane@example.com", password: "correct horse" });
      const token = await jane.passwordResetToken();

      const found = await withDatabase(db(), () => Resetting.findByPasswordResetToken(token));

      expect(found?.id).toBe(jane.id);
      expect(await withDatabase(db(), () => Resetting.findByPasswordResetToken("made.up"))).toBe(
        null,
      );
    });

    test("expires after 15 minutes", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
      const jane = await createMember();
      const token = await jane.passwordResetToken();
      const members = db().model(Member);

      vi.setSystemTime(new Date("2026-11-21T12:14:00Z"));
      expect((await members.findByTokenFor("passwordReset", token))?.id).toBe(jane.id);
      vi.setSystemTime(new Date("2026-11-21T12:15:00Z"));
      expect(await members.findByTokenFor("passwordReset", token)).toBeNull();
    });

    test("finds nothing once the password changes", async () => {
      const jane = await createMember();
      const token = await jane.passwordResetToken();

      await jane.update({ password: "battery staple" });

      expect(await db().model(Member).findByTokenFor("passwordReset", token)).toBeNull();
    });

    test("finds nothing once the password changes, even back to the same one", async () => {
      const jane = await createMember();
      const token = await jane.passwordResetToken();
      const loaded = await db().model(Member).find(jane.id);

      await loaded.update({ password: "correct horse" });

      expect(await db().model(Member).findByTokenFor("passwordReset", token)).toBeNull();
    });

    test("keeps out of the token any of the digest", async () => {
      const jane = await createMember();
      const token = await jane.passwordResetToken();
      const payload = atob(token.split(".")[0]!.replaceAll("-", "+").replaceAll("_", "/"));
      const [, , , salt, hash] = String(await storedDigest()).split("$");

      expect(payload).not.toContain(salt!.slice(-10));
      expect(payload).not.toContain(hash!.slice(-10));
    });

    test("throws InvalidToken, or RecordNotFound once the password changes, from its OrThrow", async () => {
      class Resetting extends Model.define({
        id: { type: "integer", null: false },
        email: "string",
        passwordDigest: "string",
        password: { securePassword: { resetToken: { expiresIn: { hours: 1 } } } },
      }) {
        static table = "members";
        static override signingSecret() {
          return "a-signing-secret-of-at-least-32-bytes";
        }
      }
      const jane = await db()
        .model(Resetting)
        .create({ email: "jane@example.com", password: "correct horse" });
      const token = await jane.passwordResetToken();
      await jane.update({ password: "battery staple" });

      await expect(
        withDatabase(db(), () => Resetting.findByPasswordResetTokenOrThrow("made.up")),
      ).rejects.toThrow(InvalidToken);
      await expect(
        withDatabase(db(), () => Resetting.findByPasswordResetTokenOrThrow(token)),
      ).rejects.toThrow(RecordNotFound);
    });

    test("gives a recovery password a reset token of its own purpose", async () => {
      class Staff extends Model.define({
        id: { type: "integer", null: false },
        email: "string",
        passwordDigest: "string",
        recoveryPasswordDigest: "string",
        password: { securePassword: true },
        recoveryPassword: { securePassword: true },
      }) {
        static table = "members";
        static override signingSecret() {
          return "a-signing-secret-of-at-least-32-bytes";
        }
      }
      const jane = await db().model(Staff).create({
        email: "jane@example.com",
        password: "correct horse",
        recoveryPassword: "battery staple",
      });
      const staff = db().model(Staff);
      const token = await jane.recoveryPasswordResetToken();

      expect((await staff.findByTokenFor("recoveryPasswordReset", token))?.id).toBe(jane.id);
      expect(await staff.findByTokenFor("passwordReset", token)).toBeNull();
    });

    test("can't be replaced by a purpose declared with its name", async () => {
      class Overriding extends Model.define({
        id: { type: "integer", null: false },
        email: "string",
        passwordDigest: "string",
        password: { securePassword: true },
      }) {
        static table = "members";
        static override signingSecret() {
          return "a-signing-secret-of-at-least-32-bytes";
        }
        static {
          this.generatesTokenFor("passwordReset", { expiresIn: { days: 7 } });
          this.generatesTokenFor("unsubscribe");
        }
      }
      const jane = await db()
        .model(Overriding)
        .create({ email: "jane@example.com", password: "correct horse" });

      await expect(jane.passwordResetToken()).rejects.toThrow(InvalidModel);
      await expect(jane.passwordResetToken()).rejects.toThrow(/resetToken: \{ expiresIn \}/);
      // The Model is declared wrong, so its other tokens throw too.
      await expect(jane.generateTokenFor("unsubscribe")).rejects.toThrow(InvalidModel);
    });

    test("isn't there with resetToken: false", async () => {
      class Unresettable extends Model.define({
        id: { type: "integer", null: false },
        passwordDigest: "string",
        password: { securePassword: { resetToken: false } },
      }) {
        static table = "members";
      }

      await expect(
        db().model(Unresettable).findByTokenFor("passwordReset", "made.up"),
      ).rejects.toThrow(TypeError);
    });
  });
});
