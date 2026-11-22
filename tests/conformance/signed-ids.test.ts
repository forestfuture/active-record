/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Signed ids (#517): a record's primary key, signed with the app's secret, found again only by a
// token the secret signed, for the same purpose, before it expires.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";
import {
  InvalidModel,
  InvalidToken,
  Model,
  RecordNotFound,
  RecordNotSaved,
  withDatabase,
  type SigningSecrets,
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
  models: { Member: "members", Invited: "members", Rotated: "members", Unset: "members" },
} as const;

const secret = "a-signing-secret-of-at-least-32-bytes";
const older = "an-older-signing-secret-32-bytes-long";

abstract class ApplicationRecord extends Model {
  static override schema = schema;
  static override signingSecret(): SigningSecrets {
    return secret;
  }
}

class Member extends ApplicationRecord {}
interface Member extends TableAttributes<typeof members> {}

// Only members with an invite code.
class Invited extends ApplicationRecord {
  static override table = "members";
  static {
    this.defaultScope((q) => q.whereNot({ inviteCode: null }));
  }
}
interface Invited extends TableAttributes<typeof members> {}

// A secret rotated: the older one still verifies.
class Rotated extends ApplicationRecord {
  static override table = "members";
  static override signingSecret() {
    return [secret, older];
  }
}
interface Rotated extends TableAttributes<typeof members> {}

// The default: the SECRET_KEY_BASE in the env.
abstract class PlainRecord extends Model {
  static override schema = schema;
}

class Unset extends PlainRecord {
  static override table = "members";
}

// Declared with define, so its statics find whichever database withDatabase is given.
class Visitor extends Model.define({ id: { type: "integer", null: false }, email: "string" }) {
  static override table = "members";
  static override signingSecret() {
    return secret;
  }
}
interface Unset extends TableAttributes<typeof members> {}

describe("a signed id", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const db = () => harness.connect();
  const create = (email: string, inviteCode: string | null = null) =>
    db().model(Member).create({ email, inviteCode });
  beforeEach(async () => {
    await harness.reset("members");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("finds its record again", async () => {
    const jane = await create("jane@example.com");
    await create("sam@example.com");

    const found = await db()
      .model(Member)
      .findSigned(await jane.signedId());

    expect(found?.email).toBe("jane@example.com");
  });

  test("is found from the Model's statics", async () => {
    const jane = await create("jane@example.com");
    const signedId = await jane.signedId();

    const found = await withDatabase(db(), () => Visitor.findSigned(signedId));

    expect(found?.id).toBe(jane.id);
  });

  test("holds no more than the id, readable but not forgeable", async () => {
    const jane = await create("jane@example.com");
    const signedId = await jane.signedId();

    expect(signedId).toMatch(/^[\w-]+\.[\w-]{43}$/);
    expect(signedId).not.toContain("jane");
  });

  test("finds nothing for a token changed, made up, or not a string", async () => {
    const jane = await create("jane@example.com");
    const [payload, signature] = (await jane.signedId()).split(".");
    const members = db().model(Member);

    expect(await members.findSigned(`${payload}.${signature!.slice(1)}A`)).toBeNull();
    expect(await members.findSigned("made.up")).toBeNull();
    expect(await members.findSigned(null)).toBeNull();
    expect(await members.findSigned(jane.id)).toBeNull();
  });

  test("finds nothing for another purpose", async () => {
    const jane = await create("jane@example.com");
    const members = db().model(Member);
    const forLogin = await jane.signedId({ purpose: "login" });

    expect((await members.findSigned(forLogin, { purpose: "login" }))?.id).toBe(jane.id);
    expect(await members.findSigned(forLogin)).toBeNull();
    expect(await members.findSigned(await jane.signedId(), { purpose: "login" })).toBeNull();
  });

  test("is found by another Model on its table", async () => {
    const jane = await create("jane@example.com");

    expect(
      (
        await db()
          .model(Rotated)
          .findSigned(await jane.signedId())
      )?.id,
    ).toBe(jane.id);
  });

  test("expires after expiresIn", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
    const jane = await create("jane@example.com");
    const signedId = await jane.signedId({ expiresIn: { minutes: 15 } });
    const members = db().model(Member);

    vi.setSystemTime(new Date("2026-11-21T12:14:00Z"));
    expect((await members.findSigned(signedId))?.id).toBe(jane.id);
    vi.setSystemTime(new Date("2026-11-21T12:15:00Z"));
    expect(await members.findSigned(signedId)).toBeNull();
  });

  test("expires at expiresAt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
    const jane = await create("jane@example.com");
    const signedId = await jane.signedId({ expiresAt: new Date("2026-11-22T00:00:00Z") });
    const members = db().model(Member);

    vi.setSystemTime(new Date("2026-11-21T23:59:00Z"));
    expect((await members.findSigned(signedId))?.id).toBe(jane.id);
    vi.setSystemTime(new Date("2026-11-22T00:00:00Z"));
    expect(await members.findSigned(signedId)).toBeNull();
  });

  test("refuses both expiresIn and expiresAt, and a duration that isn't one", async () => {
    const jane = await create("jane@example.com");

    await expect(jane.signedId({ expiresIn: { days: 1 }, expiresAt: new Date() })).rejects.toThrow(
      TypeError,
    );
    await expect(jane.signedId({ expiresIn: {} })).rejects.toThrow(TypeError);
    await expect(jane.signedId({ expiresIn: { minutes: -1 } })).rejects.toThrow(TypeError);
    await expect(jane.signedId({ expiresIn: { weeks: 1 } as never })).rejects.toThrow(TypeError);
    await expect(jane.signedId({ expiresAt: new Date(Number.NaN) })).rejects.toThrow(TypeError);
    await expect(jane.signedId({ expiresAt: "tomorrow" as never })).rejects.toThrow(TypeError);
    await expect(jane.signedId({ expiresIn: { days: 1e9 } })).rejects.toThrow(TypeError);
  });

  test("can't be made for a new record", async () => {
    const member = db().model(Member).build({ email: "jane@example.com" });

    await expect(member.signedId()).rejects.toThrow(RecordNotSaved);
  });

  test("finds through a Relation, keeping its conditions", async () => {
    const jane = await create("jane@example.com");
    const signedId = await jane.signedId();
    const members = db().model(Member);

    expect((await members.where({ email: "jane@example.com" }).findSigned(signedId))?.id).toBe(
      jane.id,
    );
    expect(await members.where({ email: "sam@example.com" }).findSigned(signedId)).toBeNull();
  });

  test("keeps a default scope", async () => {
    const jane = await create("jane@example.com");
    const sam = await create("sam@example.com", "welcome");
    const invited = db().model(Invited);

    expect(await invited.findSigned(await jane.signedId())).toBeNull();
    expect((await invited.findSigned(await sam.signedId()))?.id).toBe(sam.id);
  });

  test("is verified with an older secret, and signed with the newest", async () => {
    const jane = await create("jane@example.com");
    const fromNewest = await db().model(Rotated).find(jane.id);

    expect(
      (
        await db()
          .model(Member)
          .findSigned(await fromNewest.signedId())
      )?.id,
    ).toBe(jane.id);
  });

  describe("findSignedOrThrow", () => {
    test("finds its record", async () => {
      const jane = await create("jane@example.com");

      const found = await db()
        .model(Member)
        .findSignedOrThrow(await jane.signedId());

      expect(found.id).toBe(jane.id);
    });

    test("throws InvalidToken for a token that isn't valid", async () => {
      await expect(db().model(Member).findSignedOrThrow("made.up")).rejects.toThrow(InvalidToken);
    });

    test("throws RecordNotFound once its record is gone", async () => {
      const jane = await create("jane@example.com");
      const signedId = await jane.signedId();
      await jane.destroy();

      await expect(db().model(Member).findSignedOrThrow(signedId)).rejects.toThrow(RecordNotFound);
    });
  });

  describe("its secret", () => {
    test("is SECRET_KEY_BASE from the env unless the Model says otherwise", async () => {
      vi.stubEnv("SECRET_KEY_BASE", secret);
      const jane = await create("jane@example.com");
      const signedId = await (await db().model(Unset).find(jane.id)).signedId();

      expect((await db().model(Member).findSigned(signedId))?.id).toBe(jane.id);
    });

    test("must be set", async () => {
      vi.stubEnv("SECRET_KEY_BASE", undefined);
      const jane = await create("jane@example.com");
      const unset = await db().model(Unset).find(jane.id);

      await expect(unset.signedId()).rejects.toThrow(InvalidModel);
      await expect(unset.signedId()).rejects.toThrow(/SECRET_KEY_BASE/);
      await expect(db().model(Unset).findSigned("made.up")).rejects.toThrow(InvalidModel);
    });

    test("is at least 32 bytes", async () => {
      vi.stubEnv("SECRET_KEY_BASE", "short");
      const jane = await create("jane@example.com");
      const unset = await db().model(Unset).find(jane.id);

      await expect(unset.signedId()).rejects.toThrow(/at least 32 bytes/);
      await expect(unset.signedId()).rejects.not.toThrow(/short/);
    });
  });
});
