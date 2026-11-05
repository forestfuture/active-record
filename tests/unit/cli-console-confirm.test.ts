import { PassThrough } from "node:stream";
import { describe, expect, test } from "vite-plus/test";
import { confirmRemote } from "../../packages/active-record/cli/console/confirm.ts";

import type { RemoteTarget } from "../../packages/active-record/cli/adapter.ts";

type Target = RemoteTarget;
const shop: Target = { name: "shop", description: "Remote database DB (shop, id 1a2b3c)" };

/** Asks `confirmRemote` about a database, with this typed at it; what it printed, and its answer. */
async function asked(typed: string | undefined, target: Target = shop) {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = "";
  output.on("data", (chunk: Buffer) => (printed += chunk.toString()));
  const answer = confirmRemote({ input, output, target });
  if (typed === undefined) input.end();
  else input.write(`${typed}\n`);
  const { confirmed } = await answer;
  return { confirmed, printed };
}

// Before a remote session opens, the person says which database they mean (#104).
describe("confirming a remote database", () => {
  test("accepts the database's name", async () => {
    expect((await asked("shop")).confirmed).toBe(true);
  });

  test("ignores spaces around the name", async () => {
    expect((await asked("  shop  ")).confirmed).toBe(true);
  });

  test("refuses anything else", async () => {
    for (const typed of ["y", "yes", "Shop", "shop-staging", ""]) {
      expect((await asked(typed)).confirmed, JSON.stringify(typed)).toBe(false);
    }
  });

  test("refuses when the input ends without an answer", async () => {
    expect((await asked(undefined)).confirmed).toBe(false);
  });

  test("refuses a blank answer and the end of the input even for a database with no name", async () => {
    const nameless = { ...shop, name: "" };

    expect((await asked("", nameless)).confirmed).toBe(false);
    expect((await asked(undefined, nameless)).confirmed).toBe(false);
  });

  test("says which database, and that its data is real, before it asks", async () => {
    const { printed } = await asked("shop");

    expect(printed).toBe(
      "Remote database DB (shop, id 1a2b3c)\n" +
        "What you change in the console is changed in this database, not a copy.\n" +
        "Type its name to continue, anything else cancels: ",
    );
  });

  test("says what the adapter notes about it, such as a preview database", async () => {
    const { printed } = await asked("shop", {
      name: "shop",
      description: "Remote preview database DB (shop, id 9z9z)",
      note: "That is the config's preview_database_id, which Wrangler opens in place of database_id.",
    });

    expect(printed).toBe(
      "Remote preview database DB (shop, id 9z9z)\n" +
        "That is the config's preview_database_id, which Wrangler opens in place of database_id.\n" +
        "What you change in the console is changed in this database, not a copy.\n" +
        "Type its name to continue, anything else cancels: ",
    );
  });
});

// A terminal hands a pasted block over one line at a time, so what follows the answer reaches
// the process after the question has been answered: it must never reach the database.
describe("what is typed behind the answer", () => {
  /** Answers "shop", then types these at intervals; what a later reader of the input would get. */
  async function leftOver(...behind: string[]): Promise<string[]> {
    const input = new PassThrough();
    const output = new PassThrough();
    const answer = confirmRemote({ input, output, target: shop });
    input.write("shop\n");
    behind.forEach((line, index) => setTimeout(() => input.write(line), 20 * (index + 1)));

    const { release } = await answer;
    // The connection takes its time to open; meanwhile the person (or a paste) keeps going.
    await new Promise((resolve) => setTimeout(resolve, 120));
    await release();
    const left: string[] = [];
    input.on("data", (chunk: Buffer) => left.push(chunk.toString()));
    input.resume(); // as the console's REPL does when it starts
    await new Promise((resolve) => setTimeout(resolve, 100));
    return left;
  }

  test("is dropped, so it isn't run on the real database", async () => {
    expect(await leftOver("await User.deleteAll()\n", "await User.count()\n")).toEqual([]);
  });

  test("is still dropped when it arrives while the database is opening", async () => {
    expect(await leftOver("1 + 1\n")).toEqual([]);
  });
});
