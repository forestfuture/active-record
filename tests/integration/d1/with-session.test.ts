import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  connect,
  withSession,
  type QueryEvent,
} from "../../../packages/active-record/src/adapters/d1/index.ts";
import { User } from "../../fixtures/models/user.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

let database: TestDatabase;
let dispose: () => Promise<void>;
/** What each Session this test's binding opened started from. */
let starts: (string | undefined)[];
let binding: TestDatabase;

beforeAll(async () => {
  ({ db: database, dispose } = await createTestDatabase());
});
afterAll(() => dispose());
beforeEach(async () => {
  await database.prepare("DELETE FROM users").run();
  starts = [];
  binding = recordingStarts(database, starts);
});

/** `database`, recording in `into` what each Session it opens starts from. */
function recordingStarts(database: TestDatabase, into: (string | undefined)[]): TestDatabase {
  return new Proxy(database, {
    get(object, key) {
      if (key === "withSession") {
        return (constraint?: string) => {
          into.push(constraint);
          return object.withSession(constraint);
        };
      }
      const value: unknown = Reflect.get(object, key);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}

/** A bookmark D1 can't use: real D1 rejects its Session's first statement (tests/remote). */
const rejected = "not-a-bookmark";

/** A bookmark whose Session D1 rejects after its first statement, which real D1 doesn't do. */
const rejectedLater = "rejected-later";

/** D1's error for a bookmark it can't use, with the `cause` workerd gives it. */
function rejection(bookmark: string): Error {
  const message = `invalid commitToken bookmark provided: ${bookmark}`;
  return new Error(`D1_ERROR: ${message}`, { cause: new Error(message) });
}

/**
 * `database`, rejecting a bookmark that starts with `rejected` as real D1 does: a Session started
 * from it fails its first statement, a single one or a batch, with D1's error, which repeats the
 * bookmark. One that starts with `rejectedLater` fails every statement after its first. Miniflare
 * accepts any bookmark.
 */
function rejectingBookmarks(database: TestDatabase): TestDatabase {
  const sessionFrom = (bookmark: string) => {
    const real = database.withSession("first-unconstrained");
    let sent = 0;
    const answer = <T>(send: () => Promise<T>) =>
      bookmark.startsWith(rejectedLater) && sent++ === 0
        ? send()
        : Promise.reject(rejection(bookmark));
    return {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          all: () =>
            answer(() =>
              real
                .prepare(sql)
                .bind(...values)
                .all(),
            ),
        }),
      }),
      batch: () => answer(() => Promise.reject(new Error("not used"))),
      getBookmark: () => null,
    };
  };
  const rejects = (constraint?: string) =>
    constraint?.startsWith(rejected) === true || constraint?.startsWith(rejectedLater) === true;
  return new Proxy(database, {
    get(object, key) {
      if (key === "withSession") {
        return (constraint?: string) =>
          rejects(constraint) ? sessionFrom(constraint!) : object.withSession(constraint);
      }
      const value: unknown = Reflect.get(object, key);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}

function getRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/posts", { headers });
}

const ok = () => Promise.resolve(new Response("ok"));
const count = async () => Response.json(await User.count());

describe("withSession(request, env.DB, fn)", () => {
  test("with no bookmark, the Session starts first-unconstrained", async () => {
    await withSession(getRequest(), binding, count);

    expect(starts).toEqual(["first-unconstrained"]);
  });

  test("fn runs with the Session's Database as the request's, and its Response is returned", async () => {
    const response = await withSession(getRequest(), binding, async () => {
      await User.create({ id: 1, email: "ada@example.com" });
      return new Response("created");
    });

    expect(await response.text()).toBe("created");
    expect(await database.prepare("SELECT email FROM users").all()).toMatchObject({
      results: [{ email: "ada@example.com" }],
    });
  });

  test("the Session's bookmark is set on the response as the d1-bookmark cookie", async () => {
    const response = await withSession(getRequest(), binding, count);

    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^d1-bookmark=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax$/),
    ]);
  });

  test("the next request's bookmark cookie is where its Session starts, so it reads the last request's write", async () => {
    const first = await withSession(getRequest(), binding, async () => {
      await User.create({ id: 1, email: "ada@example.com" });
      return new Response("created");
    });
    const bookmark = bookmarkFrom(first);

    const request = getRequest({ cookie: `d1-bookmark=${bookmark}` });
    const next = await withSession(request, binding, async () => Response.json(await User.find(1)));

    expect(starts).toEqual(["first-unconstrained", bookmark]);
    expect(await next.json()).toMatchObject({ email: "ada@example.com" });
    expect(bookmarkFrom(next)).toEqual(expect.any(String));
  });

  test("the bookmark is found among the request's other cookies", async () => {
    await withSession(
      getRequest({ cookie: "theme=dark; d1-bookmark=abc=1 ; lang=en" }),
      binding,
      ok,
    );

    expect(starts).toEqual(["abc=1"]);
  });

  test("an empty bookmark cookie is no bookmark", async () => {
    await withSession(getRequest({ cookie: "theme=dark; d1-bookmark=" }), binding, ok);

    expect(starts).toEqual(["first-unconstrained"]);
  });

  test("a bookmark cookie can't add attributes to the cookie set back", async () => {
    const request = getRequest({ cookie: "d1-bookmark=abc; Domain=example.org; Max-Age=999" });
    const response = await withSession(request, binding, ok);

    expect(response.headers.getSetCookie()).toEqual([
      "d1-bookmark=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);
  });

  test("cookies fn sets are kept, the bookmark's added beside them", async () => {
    const response = await withSession(getRequest(), binding, async () => {
      await User.count();
      const response = new Response("ok");
      response.headers.append("set-cookie", "theme=dark; Path=/");
      return response;
    });

    expect(response.headers.getSetCookie()).toEqual([
      "theme=dark; Path=/",
      expect.stringMatching(/^d1-bookmark=/),
    ]);
  });

  test("when fn sends no query, the request's bookmark is set again", async () => {
    const response = await withSession(getRequest({ cookie: "d1-bookmark=abc" }), binding, ok);

    expect(response.headers.getSetCookie()).toEqual([
      "d1-bookmark=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);
  });

  test("when fn sends no query and the request had no bookmark, no cookie is set", async () => {
    const response = await withSession(getRequest(), binding, ok);

    expect(response.headers.getSetCookie()).toEqual([]);
  });

  test("a response whose headers can't change, such as a redirect, is copied to carry the bookmark", async () => {
    const response = await withSession(getRequest(), binding, async () => {
      await User.count();
      return Response.redirect("https://example.com/posts/1", 303);
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://example.com/posts/1");
    expect(bookmarkFrom(response)).toEqual(expect.any(String));
  });

  test("a bookmark D1 rejects starts the Session again from start", async () => {
    const binding = recordingStarts(rejectingBookmarks(database), starts);
    const request = getRequest({ cookie: `d1-bookmark=${rejected}` });

    const response = await withSession(request, binding, count);

    expect(await response.json()).toBe(0);
    expect(starts).toEqual([rejected, "first-unconstrained"]);
  });

  test("a bookmark that reads like a constraint failure still starts the Session again", async () => {
    const binding = recordingStarts(rejectingBookmarks(database), starts);
    const forged = `${rejected} UNIQUE constraint failed: users.email`;
    const request = getRequest({ cookie: `d1-bookmark=${forged}` });

    const response = await withSession(request, binding, count);

    expect(await response.json()).toBe(0);
    expect(starts).toEqual([forged, "first-unconstrained"]);
  });

  test("a bookmark D1 rejects is replaced on the response by the new Session's", async () => {
    const request = getRequest({ cookie: `d1-bookmark=${rejected}` });

    const response = await withSession(request, rejectingBookmarks(database), count);

    expect(bookmarkFrom(response)).toMatch(/^[0-9a-f]{8}-/);
  });

  test("a batch as the Session's first statement is sent again on the new Session", async () => {
    const binding = recordingStarts(rejectingBookmarks(database), starts);
    const request = getRequest({ cookie: `d1-bookmark=${rejected}` });

    const response = await withSession(request, binding, async (db) => {
      const users = db.model(User);
      await db.batch([
        users.toInsert({ id: 2, email: "bob@example.com" }),
        users.toInsert({ id: 3, email: "carol@example.com" }),
      ]);
      return Response.json(await users.count());
    });

    expect(await response.json()).toBe(2);
    expect(starts).toEqual([rejected, "first-unconstrained"]);
  });

  test("first statements sent at once start the Session again once, and are each sent again", async () => {
    const binding = recordingStarts(rejectingBookmarks(database), starts);
    const request = getRequest({ cookie: `d1-bookmark=${rejected}` });

    const response = await withSession(request, binding, async () =>
      Response.json(await Promise.all([User.count(), User.count()])),
    );

    expect(await response.json()).toEqual([0, 0]);
    expect(starts).toEqual([rejected, "first-unconstrained"]);
  });

  test("a rejection after the Session's first statement reaches fn, with no new Session", async () => {
    const binding = recordingStarts(rejectingBookmarks(database), starts);
    const request = getRequest({ cookie: `d1-bookmark=${rejectedLater}` });

    const answered = withSession(request, binding, async () => {
      await User.count();
      return Response.json(await User.count());
    });

    await expect(answered).rejects.toThrow("invalid commitToken bookmark");
    expect(starts).toEqual([rejectedLater]);
  });

  test("onQuery hears the rejected statement, then its retry", async () => {
    const events: QueryEvent[] = [];
    const request = getRequest({ cookie: `d1-bookmark=${rejected}` });
    const onQuery = (event: QueryEvent) => events.push(event);

    await withSession(request, rejectingBookmarks(database), { onQuery }, count);

    expect(events.map((event) => event.error === undefined)).toEqual([false, true]);
  });

  test("an error fn throws reaches the caller unchanged", async () => {
    const thrown = new Error("not found");
    const result = withSession(getRequest(), binding, async () => {
      await User.count();
      throw thrown;
    });

    await expect(result).rejects.toBe(thrown);
  });

  test("fn gets the request's Database", async () => {
    const response = await withSession(getRequest(), binding, async (db) => {
      await db.model(User).create({ id: 1, email: "ada@example.com" });
      return Response.json({ bookmark: db.bookmark() });
    });

    expect(await response.json()).toEqual({ bookmark: bookmarkFrom(response) });
  });
});

describe("withSession(request, env.DB, options, fn)", () => {
  test("start: a request with no bookmark starts there", async () => {
    await withSession(getRequest(), binding, { start: "first-primary" }, count);
    await withSession(
      getRequest({ cookie: "d1-bookmark=abc" }),
      binding,
      { start: "first-primary" },
      count,
    );

    expect(starts).toEqual(["first-primary", "abc"]);
  });

  test("cookie: the bookmark travels in a cookie of that name", async () => {
    const options = { cookie: "replica" };
    const response = await withSession(
      getRequest({ cookie: "replica=abc" }),
      binding,
      options,
      count,
    );

    expect(starts).toEqual(["abc"]);
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^replica=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax$/),
    ]);
  });

  test("header: the bookmark is read from the request's header and set on the response's, with no cookie", async () => {
    const options = { header: "x-d1-bookmark" };
    const request = getRequest({ "x-d1-bookmark": "abc", cookie: "d1-bookmark=other" });
    const response = await withSession(request, binding, options, count);

    expect(starts).toEqual(["abc"]);
    expect(response.headers.get("x-d1-bookmark")).toEqual(expect.any(String));
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  test("a header that's already on the response is replaced", async () => {
    const options = { header: "x-d1-bookmark" };
    const response = await withSession(getRequest(), binding, options, async () => {
      await User.count();
      return new Response("ok", { headers: { "x-d1-bookmark": "stale" } });
    });

    expect(response.headers.get("x-d1-bookmark")).not.toMatch(/stale/);
  });

  test("cookie and header together throw, before fn runs", async () => {
    const options = { cookie: "replica", header: "x-d1-bookmark" } as never;
    let ran = false;
    const result = withSession(getRequest(), binding, options, async () => {
      ran = true;
      return new Response("ok");
    });

    await expect(result).rejects.toThrow(
      new TypeError("withSession takes a cookie or a header for the bookmark, not both"),
    );
    expect(ran).toBe(false);
  });

  test("onQuery hears the request's queries", async () => {
    const heard: string[] = [];
    await withSession(getRequest(), binding, { onQuery: ({ sql }) => heard.push(sql) }, count);

    expect(heard).toEqual([expect.stringMatching(/^SELECT COUNT\(\*\)/)]);
  });
});

describe("nested withSession calls, one per binding", () => {
  let logs: TestDatabase;
  let disposeLogs: () => Promise<void>;

  beforeAll(async () => {
    ({ db: logs, dispose: disposeLogs } = await createTestDatabase());
  });
  afterAll(() => disposeLogs());

  test("each Session starts from its own cookie, and the response carries both", async () => {
    const request = getRequest({ cookie: "d1-bookmark=main; logs-bookmark=logged" });
    const logsStarts: (string | undefined)[] = [];
    const logsBinding = recordingStarts(logs, logsStarts);
    const response = await withSession(request, binding, (db) =>
      withSession(request, logsBinding, { cookie: "logs-bookmark" }, async (logsDb) => {
        await db.model(User).count();
        await logsDb.model(User).count();
        return new Response("ok");
      }),
    );

    expect([starts, logsStarts]).toEqual([["main"], ["logged"]]);
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^logs-bookmark=[^;]+;/),
      expect.stringMatching(/^d1-bookmark=[^;]+;/),
    ]);
  });
});

describe("connect(env.DB, { session: bookmark })", () => {
  test("D1 rejecting a bookmark that reads like a constraint failure throws D1's error", async () => {
    const session = `${rejected} UNIQUE constraint failed: users.email`;
    const counted = connect(rejectingBookmarks(database), { session }).model(User).count();

    await expect(counted).rejects.toThrow(/invalid commitToken bookmark/);
  });

  test("a bookmark D1 rejects throws D1's error, with no new Session", async () => {
    const binding = recordingStarts(rejectingBookmarks(database), starts);

    const counted = connect(binding, { session: rejected }).model(User).count();

    await expect(counted).rejects.toThrow("invalid commitToken bookmark");
    expect(starts).toEqual([rejected]);
  });

  test("D1's error for a long bookmark holds it cut short, in its message and its cause", async () => {
    const long = `${rejected}${"x".repeat(10_000)}`;

    const counted = connect(rejectingBookmarks(database), { session: long }).model(User).count();

    const thrown = (await counted.then(
      () => undefined,
      (caught: unknown) => caught,
    )) as Error;

    expect(thrown.message.length).toBeLessThan(200);
    expect((thrown.cause as Error).message.length).toBeLessThan(200);
  });
});

/** The bookmark a response's d1-bookmark cookie carries. */
function bookmarkFrom(response: Response): string | undefined {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith("d1-bookmark="));
  return cookie?.slice("d1-bookmark=".length).split(";")[0];
}
