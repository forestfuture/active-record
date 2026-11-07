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
import { connect } from "../../../packages/pg-record/src/index.ts";
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

describe("opening a pg-record client times out (#292)", () => {
  let host: SilentHost;

  beforeEach(async () => {
    host = await openSilentHost();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await host.close();
  });

  test("a host that never answers fails the query after 10 seconds", async () => {
    const query = watch(connect(host.url()).model(User).count());
    await host.reached;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(query.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await query.outcome).toMatchObject(timedOut);
  });

  test("an open that fails before the limit fails with its own error", async () => {
    const url = host.url();
    await host.close();
    await expect(connect(url).model(User).count()).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  /** Sends a query to the silent host, and runs `pg`'s connect timer for `ms` once it's there. */
  const pendingAfter = async (query: string, ms: number) => {
    const sent = watch(connect(host.url(query)).model(User).count());
    await host.reached;
    await vi.advanceTimersByTimeAsync(ms);
    return sent;
  };

  test.each([
    ["?connect_timeout=3", 3_000],
    ["?sslmode=disable&connect_timeout=30", 30_000],
    ["?connect_timeout=1", 2_000],
  ])("%s in the connection string fails it after %ims", async (query, ms) => {
    const sent = await pendingAfter(query, ms - 1);
    expect(sent.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await sent.outcome).toMatchObject(timedOut);
  });

  test.each(["?connect_timeout=0", "?connect_timeout=-5"])(
    "%s waits for the host as long as it takes",
    async (query) => {
      const sent = await pendingAfter(query, 3_600_000);
      expect(sent.settled).toBe(false);
      // Only the host closing the connection ends the wait.
      await host.close();
      expect(await sent.outcome).toMatchObject({ code: "ECONNRESET" });
    },
  );

  test("a connect_timeout longer than a timer can wait doesn't fail the query at once", async () => {
    const sent = await pendingAfter("?connect_timeout=99999999", 3_600_000);
    expect(sent.settled).toBe(false);
    await host.close();
    expect(await sent.outcome).toMatchObject({ code: "ECONNRESET" });
  });

  test.each(["soon", "", "1.5", "10s"])(
    "a connect_timeout of %j throws when the Database is built, naming it but not the URL",
    (value) => {
      const url = host.url(`?connect_timeout=${value}`).replace("app@", "app:secret@");
      expect(() => connect(url)).toThrow(
        new TypeError(
          `connect_timeout must be a whole number of seconds, not ${JSON.stringify(value)}`,
        ),
      );
    },
  );
});

describe("a connection string's connect_timeout, on a server that answers (#292)", () => {
  let schema: PgSchema;

  beforeAll(async () => {
    schema = await openPgSchema();
  });
  afterAll(async () => {
    await schema.dispose();
  });

  test("is pg-record's alone: the server never hears it", async () => {
    const db = connect(`${schema.url}&connect_timeout=5`);
    expect(await db.model(User).count()).toBe(0);
  });
});
