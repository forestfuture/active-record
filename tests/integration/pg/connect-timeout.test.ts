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
import { Model } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";
import { openSilentHost, type SilentHost } from "../../support/silent-host.ts";

class User extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "users";
}

/** The error for an open that took too long: libpq's, as `pg` gives it on Node. */
const timedOut = { message: "timeout expired" };

/** A query's outcome, and whether it has one yet. */
function watch(query: Promise<unknown>) {
  const state = { settled: false };
  const outcome = query.then(
    () => "resolved",
    (error: unknown) => error,
  );
  void outcome.finally(() => (state.settled = true));
  return Object.assign(state, { outcome });
}

describe("a query to a host that never answers (#292)", () => {
  let host: SilentHost;

  beforeEach(async () => {
    host = await openSilentHost();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await host.close();
  });

  /** Sends a query to the silent host, and runs `pg`'s connect timer for `ms` once it's there. */
  const pendingAfter = async (query: string, ms: number) => {
    const sent = watch(connect(host.url(query)).model(User).count());
    await host.reached;
    await vi.advanceTimersByTimeAsync(ms);
    return sent;
  };

  test.each([
    ["with no connect_timeout", 10_000, ""],
    ["with connect_timeout=3", 3_000, "?connect_timeout=3"],
    [
      "with connect_timeout=30 after another parameter",
      30_000,
      "?sslmode=disable&connect_timeout=30",
    ],
    ["with connect_timeout=1, libpq's shortest of 2", 2_000, "?connect_timeout=1"],
  ])("%s fails after %ims", async (_name, ms, query) => {
    const sent = await pendingAfter(query, ms - 1);
    expect(sent.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await sent.outcome).toMatchObject(timedOut);
  });

  test.each([
    ["with connect_timeout=0", "?connect_timeout=0"],
    ["with a negative connect_timeout", "?connect_timeout=-5"],
    ["with a connect_timeout longer than a timer can wait", "?connect_timeout=99999999"],
  ])("%s is still waiting an hour later", async (_name, query) => {
    const sent = await pendingAfter(query, 3_600_000);
    expect(sent.settled).toBe(false);
    // Only the host closing the connection ends the wait.
    await host.close();
    expect(await sent.outcome).toMatchObject({ code: "ECONNRESET" });
  });
});

describe("a query to a host that refuses the connection (#292)", () => {
  test("fails with its own error, not the timeout's", async () => {
    const host = await openSilentHost();
    await host.close();
    await expect(connect(host.url()).model(User).count()).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
  });
});

describe("a connection string's connect_timeout (#292)", () => {
  let schema: PgSchema;

  beforeAll(async () => {
    schema = await openPgSchema();
  });
  afterAll(async () => {
    await schema.dispose();
  });

  test.each(["soon", "", "1.5", "10s"])(
    "of %j throws when the Database is built, naming it but not the URL",
    (value) => {
      const url = `postgres://app:secret@db.example.com/app?connect_timeout=${value}`;
      expect(() => connect(url)).toThrow(
        new TypeError(
          `connect_timeout must be a whole number of seconds, not ${JSON.stringify(value)}`,
        ),
      );
    },
  );

  test("is read from a socket's string, with no host before its path", () => {
    const url = "postgres://app@/app?host=/var/run/postgresql&connect_timeout=soon";
    expect(() => connect(url)).toThrow(TypeError);
  });

  test("is ignored after a #, which ends the query", () => {
    const url = "postgres://app@db.example.com/app#x?connect_timeout=soon";
    expect(() => connect(url)).not.toThrow();
  });

  test("given twice, is the last, as pg reads it", () => {
    const url = "postgres://app@db.example.com/app?connect_timeout=soon&connect_timeout=5";
    expect(() => connect(url)).not.toThrow();
  });

  test("leaves a server that answers serving the query", async () => {
    const db = connect(`${schema.url}&connect_timeout=5`);
    expect(await db.model(User).count()).toBe(0);
  });
});
