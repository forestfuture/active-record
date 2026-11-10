import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  openLocalBinding,
  openRemoteBinding,
} from "../../../packages/active-record/cli/adapters/d1/binding.ts";
import type { ChosenDatabase } from "../../../packages/active-record/cli/adapter.ts";
import type { TestDatabase } from "../../support/d1.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();

/** The first D1 binding of the project's wrangler.jsonc, as `active-record console` would choose it. */
function chosen(cwd: string): ChosenDatabase {
  const configFile = join(cwd, "wrangler.jsonc");
  const config = JSON.parse(readFileSync(configFile, "utf8")) as {
    d1_databases?: Record<string, unknown>[];
  };
  const entry = config.d1_databases?.[0] ?? { binding: "DB" };
  return { binding: "DB", entry, configFile, migrationsDir: join(cwd, "migrations") };
}

/** A project in the repo (so it finds this repo's wrangler) with one D1 binding configured. */
function project(binding: object): string {
  const dir = scratch("console-binding-");
  writeFileSync(join(dir, "wrangler.jsonc"), JSON.stringify({ d1_databases: [binding] }));
  return dir;
}

describe("the console's local database binding", () => {
  test("is the project's local D1, kept in .wrangler/state between sessions", async () => {
    const cwd = project({ binding: "DB", database_name: "shop", database_id: "local-shop" });
    const first = await openLocalBinding(cwd, chosen(cwd));
    if (typeof first === "string") throw new Error(first);
    const db = first.binding as TestDatabase;
    await db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    await db.prepare("INSERT INTO notes (id, body) VALUES (1, 'kept')").run();
    await first.dispose();

    const second = await openLocalBinding(cwd, chosen(cwd));
    if (typeof second === "string") throw new Error(second);
    const kept = await (second.binding as TestDatabase)
      .prepare("SELECT body FROM notes WHERE id = 1")
      .first("body");
    await second.dispose();

    expect(kept).toBe("kept");
    // Beside the config, where wrangler dev keeps it, not wherever the command runs from.
    expect(existsSync(join(cwd, ".wrangler/state/v3/d1"))).toBe(true);
    expect(existsSync(join(process.cwd(), ".wrangler"))).toBe(false);
    expect(first.description).toBe("Local database DB (.wrangler/state)");
  }, 60_000);

  test("stays local when the config marks the binding remote", async () => {
    const cwd = project({
      binding: "DB",
      database_name: "shop",
      database_id: "0000-remote",
      remote: true,
    });

    const opened = await openLocalBinding(cwd, chosen(cwd));
    if (typeof opened === "string") throw new Error(opened);
    const one = await (opened.binding as TestDatabase).prepare("SELECT 1 AS one").first("one");
    await opened.dispose();

    expect(one).toBe(1);
  }, 60_000);

  test("a project without wrangler is told so", async () => {
    // Outside the repo, so no wrangler is in reach.
    const cwd = scratch("console-nowrangler-", true);
    writeFileSync(join(cwd, "wrangler.jsonc"), "{}");

    expect(await openLocalBinding(cwd, chosen(cwd))).toBe(
      "wrangler isn't installed here (install it, then run active-record console again)",
    );
  });

  test("a wrangler that fails to load is reported as that, not as missing", async () => {
    const cwd = scratch("console-brokenwrangler-", true);
    mkdirSync(join(cwd, "node_modules/wrangler"), { recursive: true });
    writeFileSync(
      join(cwd, "node_modules/wrangler/package.json"),
      '{ "name": "wrangler", "type": "module", "exports": "./index.js" }',
    );
    writeFileSync(
      join(cwd, "node_modules/wrangler/index.js"),
      'throw new Error("engine mismatch");',
    );
    writeFileSync(join(cwd, "wrangler.jsonc"), "{}");

    expect(await openLocalBinding(cwd, chosen(cwd))).toBe(
      "Couldn't load wrangler: engine mismatch",
    );
  });

  test("a D1 entry wrangler rejects is reported with wrangler's reason", async () => {
    // A database_id must be a string; the entry reaches wrangler as the config has it.
    const cwd = project({ binding: "DB", database_name: "shop", database_id: 42 });

    const opened = await openLocalBinding(cwd, chosen(cwd));

    expect(opened).toMatch(/^Wrangler couldn't open DB: /);
  }, 60_000);

  test("opens only the D1 binding: the rest of the config can't warn or fail", async () => {
    const cwd = project({ binding: "DB", database_name: "shop", database_id: "local-shop" });
    const configFile = join(cwd, "wrangler.jsonc");
    writeFileSync(
      configFile,
      JSON.stringify({
        name: "shop",
        compatibility_date: "2025-09-01",
        d1_databases: [{ binding: "DB", database_name: "shop", database_id: "local-shop" }],
        // Not exported by any Worker here, as in a project whose Durable Objects live elsewhere.
        durable_objects: { bindings: [{ name: "USERS", class_name: "User" }] },
        vars: { GREETING: "hi" },
      }),
    );
    writeFileSync(join(cwd, ".dev.vars"), "SECRET=1\n");
    const written: string[] = [];
    const record = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    const out = vi.spyOn(process.stdout, "write").mockImplementation(record);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(record);
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((...args) => void record(args.join(" ")));
    const warn = vi
      .spyOn(console, "warn")
      .mockImplementation((...args) => void record(args.join(" ")));

    let opened: Awaited<ReturnType<typeof openLocalBinding>>;
    try {
      opened = await openLocalBinding(cwd, chosen(cwd));
    } finally {
      for (const spy of [out, err, log, warn]) spy.mockRestore();
    }
    if (typeof opened === "string") throw new Error(opened);
    const db = opened.binding as TestDatabase;
    await db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY)");
    await opened.dispose();

    expect(written.join("")).toBe("");
    expect(existsSync(join(cwd, ".wrangler/state/v3/d1"))).toBe(true);
  }, 60_000);
});

/** What the fake wrangler saw of one `getPlatformProxy` call. */
interface Call {
  options: Record<string, unknown>;
  /** The config file it was pointed at, as it was while the call ran. */
  config: Record<string, unknown>;
  configPath: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __fakeWrangler:
    | { calls: Call[]; disposed: number; fail?: string; failDispose?: boolean }
    | undefined;
}

/** A project outside the repo whose own `wrangler` records the call it gets, and says no on cue. */
function projectWithFakeWrangler(config: object = {}): string {
  const cwd = scratch("console-remote-", true);
  mkdirSync(join(cwd, "node_modules/wrangler"), { recursive: true });
  writeFileSync(
    join(cwd, "node_modules/wrangler/package.json"),
    '{ "name": "wrangler", "type": "module", "exports": "./index.js" }',
  );
  writeFileSync(
    join(cwd, "node_modules/wrangler/index.js"),
    `import { readFileSync } from "node:fs";
     export async function getPlatformProxy(options) {
       const seen = globalThis.__fakeWrangler;
       seen.calls.push({
         options,
         configPath: options.configPath,
         config: JSON.parse(readFileSync(options.configPath, "utf8")),
       });
       if (seen.fail !== undefined) throw new Error(seen.fail);
       return { env: { DB: "the remote binding" }, dispose: async () => { seen.disposed += 1; if (seen.failDispose) throw new Error("proxy would not stop"); } };
     }`,
  );
  writeFileSync(join(cwd, "wrangler.jsonc"), JSON.stringify(config));
  return cwd;
}

// `--remote` (#104): the same binding, on the project's real D1 through Wrangler's remote proxy.
describe("the console's remote database binding", () => {
  const entry = { binding: "DB", database_name: "shop", database_id: "1a2b3c" };
  const remote = (cwd: string, more: Partial<ChosenDatabase> = {}): ChosenDatabase => ({
    binding: "DB",
    entry,
    configFile: join(cwd, "wrangler.jsonc"),
    migrationsDir: join(cwd, "migrations"),
    ...more,
  });
  beforeEach(() => {
    globalThis.__fakeWrangler = { calls: [], disposed: 0 };
  });

  test("asks wrangler for the D1 binding as a remote one, with nothing kept locally", async () => {
    const cwd = projectWithFakeWrangler();

    const opened = await openRemoteBinding(cwd, remote(cwd));
    if (typeof opened === "string") throw new Error(opened);

    const [call] = globalThis.__fakeWrangler!.calls;
    expect(opened.binding).toBe("the remote binding");
    expect(call!.options).toMatchObject({ remoteBindings: true, persist: false });
    expect(call!.config.d1_databases).toEqual([{ ...entry, remote: true }]);
    await opened.dispose();
  });

  test("marks the binding remote even when the project's config doesn't", async () => {
    const cwd = projectWithFakeWrangler();

    const opened = await openRemoteBinding(
      cwd,
      remote(cwd, { entry: { ...entry, remote: false } }),
    );
    if (typeof opened === "string") throw new Error(opened);

    const [call] = globalThis.__fakeWrangler!.calls;
    expect(call!.config.d1_databases).toEqual([{ ...entry, remote: true }]);
    await opened.dispose();
  });

  test("passes the preview database through as the config has it", async () => {
    const cwd = projectWithFakeWrangler();
    const withPreview = { ...entry, preview_database_id: "9z9z" };

    const opened = await openRemoteBinding(cwd, remote(cwd, { entry: withPreview }));
    if (typeof opened === "string") throw new Error(opened);

    const [call] = globalThis.__fakeWrangler!.calls;
    expect(call!.config.d1_databases).toEqual([{ ...withPreview, remote: true }]);
    await opened.dispose();
  });

  test("keeps the config's account, since its own config would lose it", async () => {
    const cwd = projectWithFakeWrangler({ account_id: "acct-1", d1_databases: [entry] });

    const opened = await openRemoteBinding(cwd, remote(cwd));
    if (typeof opened === "string") throw new Error(opened);

    const [call] = globalThis.__fakeWrangler!.calls;
    expect(call!.config.account_id).toBe("acct-1");
    await opened.dispose();
  });

  test("reads the account from a TOML config", async () => {
    const cwd = projectWithFakeWrangler();
    const configFile = join(cwd, "wrangler.toml");
    writeFileSync(
      configFile,
      'name = "shop"\naccount_id = "acct-2"\n\n[[d1_databases]]\nbinding = "DB"\n',
    );

    const opened = await openRemoteBinding(cwd, remote(cwd, { configFile }));
    if (typeof opened === "string") throw new Error(opened);

    const [call] = globalThis.__fakeWrangler!.calls;
    expect(call!.config.account_id).toBe("acct-2");
    await opened.dispose();
  });

  test("names no account when the config can't be read again", async () => {
    const cwd = projectWithFakeWrangler();
    writeFileSync(join(cwd, "wrangler.jsonc"), "{ not json");

    const opened = await openRemoteBinding(cwd, remote(cwd));
    if (typeof opened === "string") throw new Error(opened);

    const [call] = globalThis.__fakeWrangler!.calls;
    expect(call!.config).not.toHaveProperty("account_id");
    await opened.dispose();
  });

  test("names no account when the config names none", async () => {
    const cwd = projectWithFakeWrangler({ d1_databases: [entry] });

    const opened = await openRemoteBinding(cwd, remote(cwd));
    if (typeof opened === "string") throw new Error(opened);

    const [call] = globalThis.__fakeWrangler!.calls;
    expect(call!.config).not.toHaveProperty("account_id");
    await opened.dispose();
  });

  test("says which database it opened", async () => {
    const cwd = projectWithFakeWrangler();

    const opened = await openRemoteBinding(cwd, remote(cwd));
    if (typeof opened === "string") throw new Error(opened);

    expect(opened.description).toBe("Remote database DB (shop, id 1a2b3c)");
    await opened.dispose();
  });

  test("says when it is the preview database that it opened", async () => {
    const cwd = projectWithFakeWrangler();
    const withPreview = { ...entry, preview_database_id: "9z9z" };

    const opened = await openRemoteBinding(cwd, remote(cwd, { entry: withPreview }));
    if (typeof opened === "string") throw new Error(opened);

    expect(opened.description).toBe("Remote preview database DB (shop, id 9z9z)");
    await opened.dispose();
  });

  test("closes the proxy and removes its temporary config", async () => {
    const cwd = projectWithFakeWrangler();
    const opened = await openRemoteBinding(cwd, remote(cwd));
    if (typeof opened === "string") throw new Error(opened);
    const { configPath } = globalThis.__fakeWrangler!.calls[0]!;
    expect(existsSync(configPath)).toBe(true);

    await opened.dispose();

    expect(globalThis.__fakeWrangler!.disposed).toBe(1);
    expect(existsSync(configPath)).toBe(false);
  });

  test("removes its temporary config even when the proxy fails to stop", async () => {
    const cwd = projectWithFakeWrangler();
    globalThis.__fakeWrangler!.failDispose = true;
    const opened = await openRemoteBinding(cwd, remote(cwd));
    if (typeof opened === "string") throw new Error(opened);
    const { configPath } = globalThis.__fakeWrangler!.calls[0]!;

    await expect(opened.dispose()).rejects.toThrow("proxy would not stop");

    expect(existsSync(configPath)).toBe(false);
  });

  test("removes its temporary config if the process exits first, and leaves no listener behind", async () => {
    const cwd = projectWithFakeWrangler();
    const before = process.listenerCount("exit");
    const opened = await openRemoteBinding(cwd, remote(cwd));
    if (typeof opened === "string") throw new Error(opened);
    const { configPath } = globalThis.__fakeWrangler!.calls[0]!;
    expect(process.listenerCount("exit")).toBe(before + 1);

    process.listeners("exit").at(-1)!.call(process, 0);
    expect(existsSync(configPath)).toBe(false);

    await opened.dispose();
    expect(process.listenerCount("exit")).toBe(before);
  });

  test("a refusal from Cloudflare comes with how to sign in", async () => {
    const cwd = projectWithFakeWrangler();
    globalThis.__fakeWrangler!.fail = "A request to the Cloudflare API failed (code 10000)";

    const opened = await openRemoteBinding(cwd, remote(cwd));

    expect(opened).toBe(
      "Wrangler couldn't open DB remotely: A request to the Cloudflare API failed (code 10000)\n" +
        "Sign in with 'wrangler login', or set CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID).",
    );
    expect(existsSync(globalThis.__fakeWrangler!.calls[0]!.configPath)).toBe(false);
  });

  test("a project without wrangler is told so", async () => {
    const cwd = scratch("console-remote-nowrangler-", true);
    writeFileSync(join(cwd, "wrangler.jsonc"), "{}");

    expect(await openRemoteBinding(cwd, remote(cwd))).toBe(
      "wrangler isn't installed here (install it, then run active-record console again)",
    );
  });
});
