/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Tokens for a purpose (#517): `generatesTokenFor` declares one, signed with the app's secret,
// that finds its record until it expires or a value it depends on changes.
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
  models: { Member: "members", Invited: "members", Renewed: "members" },
} as const;

const secret = "a-signing-secret-of-at-least-32-bytes";

abstract class ApplicationRecord extends Model {
  static override schema = schema;
  static override signingSecret() {
    return secret;
  }
}

class Member extends ApplicationRecord {
  static {
    this.generatesTokenFor("emailConfirmation", {
      expiresIn: { days: 1 },
      dependsOn: (member) => member.email,
    });
    this.generatesTokenFor("unsubscribe");
    // A value that may be missing: undefined is a value too.
    this.generatesTokenFor("invitation", { dependsOn: (member) => member.inviteCode ?? undefined });
  }
}
interface Member extends TableAttributes<typeof members> {}

// Only members with an invite code.
class Invited extends ApplicationRecord {
  static override table = "members";
  static {
    this.defaultScope((q) => q.whereNot({ inviteCode: null }));
    this.generatesTokenFor("unsubscribe");
  }
}
interface Invited extends TableAttributes<typeof members> {}

// The same purpose, lasting a week instead.
class Renewed extends ApplicationRecord {
  static override table = "members";
  static {
    this.generatesTokenFor("emailConfirmation", {
      expiresIn: { days: 7 },
      dependsOn: (member) => member.email,
    });
  }
}
interface Renewed extends TableAttributes<typeof members> {}

describe("a token for a purpose", () => {
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
  });

  test("finds its record again, for its purpose", async () => {
    const jane = await create("jane@example.com");
    await create("sam@example.com");
    const token = await jane.generateTokenFor("unsubscribe");

    const found = await db().model(Member).findByTokenFor("unsubscribe", token);

    expect(found?.email).toBe("jane@example.com");
  });

  test("finds nothing for another purpose, nor as a signed id", async () => {
    const jane = await create("jane@example.com");
    const members = db().model(Member);
    const token = await jane.generateTokenFor("unsubscribe");

    expect(await members.findByTokenFor("emailConfirmation", token)).toBeNull();
    expect(await members.findSigned(token)).toBeNull();
    expect(await members.findByTokenFor("unsubscribe", await jane.signedId())).toBeNull();
  });

  test("finds nothing for a token changed, made up, or not a string", async () => {
    const jane = await create("jane@example.com");
    const [payload, signature] = (await jane.generateTokenFor("unsubscribe")).split(".");
    const members = db().model(Member);

    expect(
      await members.findByTokenFor("unsubscribe", `${payload}.${signature!.slice(1)}A`),
    ).toBeNull();
    expect(await members.findByTokenFor("unsubscribe", "made.up")).toBeNull();
    expect(await members.findByTokenFor("unsubscribe", undefined)).toBeNull();
  });

  test("expires after its expiresIn", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
    const jane = await create("jane@example.com");
    const token = await jane.generateTokenFor("emailConfirmation");
    const members = db().model(Member);

    vi.setSystemTime(new Date("2026-11-22T11:59:00Z"));
    expect((await members.findByTokenFor("emailConfirmation", token))?.id).toBe(jane.id);
    vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
    expect(await members.findByTokenFor("emailConfirmation", token)).toBeNull();
  });

  test("finds nothing once a value it depends on changes, and again once it's back", async () => {
    const jane = await create("jane@example.com");
    const token = await jane.generateTokenFor("emailConfirmation");
    const members = db().model(Member);

    await jane.update({ email: "jane@example.org" });
    expect(await members.findByTokenFor("emailConfirmation", token)).toBeNull();
    await jane.update({ email: "jane@example.com" });
    expect((await members.findByTokenFor("emailConfirmation", token))?.id).toBe(jane.id);
  });

  test("finds its record while a value it depends on stays undefined", async () => {
    const jane = await create("jane@example.com");
    const token = await jane.generateTokenFor("invitation");
    const members = db().model(Member);

    expect((await members.findByTokenFor("invitation", token))?.id).toBe(jane.id);
    await jane.update({ inviteCode: "welcome" });
    expect(await members.findByTokenFor("invitation", token)).toBeNull();
  });

  test("finds nothing once its purpose lasts another time", async () => {
    const jane = await create("jane@example.com");
    const token = await jane.generateTokenFor("emailConfirmation");

    expect(await db().model(Renewed).findByTokenFor("emailConfirmation", token)).toBeNull();
  });

  test("is found from the Model's statics", async () => {
    // Declared with define, so its statics find whichever database withDatabase is given.
    class Subscriber extends Model.define({
      id: { type: "integer", null: false },
      email: "string",
    }) {
      static override table = "members";
      static override signingSecret() {
        return secret;
      }
      static {
        this.generatesTokenFor("unsubscribe");
      }
    }
    const jane = await db().model(Subscriber).create({ email: "jane@example.com" });

    const token = await jane.generateTokenFor("unsubscribe");

    const found = await withDatabase(db(), () => Subscriber.findByTokenFor("unsubscribe", token));
    expect(found?.id).toBe(jane.id);
  });

  test("finds through a Relation, keeping its conditions and default scopes", async () => {
    const jane = await create("jane@example.com");
    const sam = await create("sam@example.com", "welcome");
    const members = db().model(Member);
    const invited = db().model(Invited);
    const forJane = await jane.generateTokenFor("unsubscribe");

    expect(
      await members.where({ email: "sam@example.com" }).findByTokenFor("unsubscribe", forJane),
    ).toBeNull();
    expect(await invited.findByTokenFor("unsubscribe", forJane)).toBeNull();
    const forSam = await (await invited.find(sam.id)).generateTokenFor("unsubscribe");
    expect((await invited.findByTokenFor("unsubscribe", forSam))?.id).toBe(sam.id);
  });

  test("can't be made for a new record", async () => {
    const member = db().model(Member).build({ email: "jane@example.com" });

    await expect(member.generateTokenFor("unsubscribe")).rejects.toThrow(RecordNotSaved);
  });

  test("throws for a purpose its Model doesn't declare", async () => {
    const jane = await create("jane@example.com");

    await expect(jane.generateTokenFor("login")).rejects.toThrow(TypeError);
    await expect(db().model(Member).findByTokenFor("login", "made.up")).rejects.toThrow(
      /generatesTokenFor\("login"/,
    );
  });

  test("refuses a declaration that isn't one", () => {
    const declare = (purpose: string, options?: object) => {
      class Broken extends ApplicationRecord {
        static override table = "members";
        static {
          this.generatesTokenFor(purpose, options as never);
        }
      }
      return Broken;
    };

    expect(() => declare("")).toThrow(InvalidModel);
    expect(() => declare("reset", { expiresIn: { minutes: -1 } })).toThrow(TypeError);
    expect(() => declare("reset", { expiresIn: { days: 1e306 } })).toThrow(TypeError);
    expect(() => declare("reset", { expiresIn: { days: 1e9 } })).toThrow(TypeError);
    expect(() => declare("reset", { dependsOn: "email" })).toThrow(InvalidModel);
    expect(() => declare("reset", { expires: { days: 1 } })).toThrow(InvalidModel);
  });

  describe("findByTokenForOrThrow", () => {
    test("finds its record", async () => {
      const jane = await create("jane@example.com");
      const token = await jane.generateTokenFor("unsubscribe");

      expect((await db().model(Member).findByTokenForOrThrow("unsubscribe", token)).id).toBe(
        jane.id,
      );
    });

    test("throws InvalidToken for a token that isn't valid", async () => {
      await expect(
        db().model(Member).findByTokenForOrThrow("unsubscribe", "made.up"),
      ).rejects.toThrow(InvalidToken);
    });

    test("throws RecordNotFound once a value it depends on changes", async () => {
      const jane = await create("jane@example.com");
      const token = await jane.generateTokenFor("emailConfirmation");
      await jane.update({ email: "jane@example.org" });

      await expect(
        db().model(Member).findByTokenForOrThrow("emailConfirmation", token),
      ).rejects.toThrow(RecordNotFound);
    });
  });
});
