import { describe, expect, test } from "vite-plus/test";
import {
  abort,
  CallbackAbort,
  InvalidModel,
  Model,
  RecordNotSaved,
} from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/d1-record/src/index.ts";

const log: string[] = [];

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  static {
    this.beforeValidation((user) => {
      log.push("beforeValidation 1");
      user.email = user.email?.trim() ?? null;
    });
    this.beforeValidation(async () => {
      await Promise.resolve();
      log.push("beforeValidation 2");
    });
    this.validates("email", {
      presence: true,
      if: () => {
        log.push("validators");
        return true;
      },
    });
    this.afterValidation((user) => {
      log.push(`afterValidation (${user.errors.size} errors)`);
    });
  }
}

const users = connect({} as never).model(User);

describe("validation callbacks", () => {
  test("run before and after the validators, in declaration order, awaiting async ones", async () => {
    log.length = 0;
    const user = users.build({ email: "  a@example.com  " });

    expect(await user.isValid()).toBe(true);

    expect(log).toEqual([
      "beforeValidation 1",
      "beforeValidation 2",
      "validators",
      "afterValidation (0 errors)",
    ]);
    expect(user.email).toBe("a@example.com");
  });

  test("abort() in a validation callback makes the record invalid, with a reason but no errors", async () => {
    const accounts = connect({} as never).model(Account);
    const account = accounts.build({ email: "a@example.com", suspended: true });

    expect(await account.isValid()).toBe(false);
    expect(account.abortReason).toBe("Account is suspended");
    expect(account.errors.isEmpty()).toBe(true);

    account.suspended = false;
    expect(await account.isValid()).toBe(true);
    expect(account.abortReason).toBeUndefined();
  });

  test("an aborted save returns false, and saveOrThrow throws RecordNotSaved with the reason", async () => {
    const account = connect({} as never)
      .model(Account)
      .build({ email: "a@example.com", suspended: true });

    expect(await account.save()).toBe(false);
    const error = await account.saveOrThrow().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RecordNotSaved);
    expect((error as Error).message).toMatch(/Account is suspended/);
    expect(account.isNewRecord()).toBe(true);
  });

  test("abort() creates a CallbackAbort; any other error from a callback propagates unchanged", async () => {
    const failure = new Error("callback bug");
    class Broken extends Model.define({ id: "integer" }) {
      static table = "users";
      static {
        this.beforeValidation(() => {
          throw failure;
        });
      }
    }

    expect(abort("why")).toBeInstanceOf(CallbackAbort);
    await expect(
      connect({} as never)
        .model(Broken)
        .build()
        .isValid(),
    ).rejects.toBe(failure);
  });
});

class Account extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  suspended: "boolean",
}) {
  static table = "users";

  static {
    this.beforeValidation((account) => {
      if (account.suspended) throw abort("Account is suspended");
    });
  }
}

describe("callback inheritance", () => {
  test("a subclass runs its parent's callbacks plus its own; the parent never gets the subclass's", async () => {
    log.length = 0;
    class Admin extends User {
      static {
        this.afterValidation(() => void log.push("admin afterValidation"));
      }
    }

    await connect({} as never)
      .model(Admin)
      .build({ email: "a@example.com" })
      .isValid();
    const adminLog = [...log];
    log.length = 0;
    await users.build({ email: "a@example.com" }).isValid();

    expect(adminLog.at(-1)).toBe("admin afterValidation");
    expect(log).not.toContain("admin afterValidation");
  });
});

describe("declaration timing", () => {
  test("declaring on a Model after its first use throws, so requests can't add callbacks", () => {
    class Note extends Model.define({ id: "integer", body: "string" }) {
      static table = "notes";
    }
    connect({} as never).model(Note);

    expect(() => Note.beforeSave(() => {})).toThrow(InvalidModel);
    expect(() => Note.validates("body", { presence: true })).toThrow(/Note.*static \{\}/);
  });
});

describe("abort in afterValidation", () => {
  test("refuses too: isValid is false with the reason", async () => {
    class Gate extends Model.define({ id: "integer", email: "string" }) {
      static table = "users";
      static {
        this.afterValidation((gate) => {
          if (gate.errors.isEmpty()) throw abort("closed");
        });
      }
    }
    const gate = connect({} as never)
      .model(Gate)
      .build();

    expect(await gate.isValid()).toBe(false);
    expect(gate.abortReason).toBe("closed");
  });
});
