import { describe, expect, test } from "vite-plus/test";
import { connect } from "../../packages/d1-record/src/index.ts";
import { User } from "../fixtures/models/user.ts";
import { underscore } from "../../packages/active-record/src/naming.ts";
import { originalUnderscore } from "../support/naming-oracle.ts";

// No D1 needed: building a record and reading its errors never queries.
const users = connect({} as never).model(User);

// Letters of both cases, a digit and an underscore, so every neighbouring pair the rules look at
// (capital after lowercase, capital after digit, run of capitals before a lowercase) comes up.
const alphabet = ["a", "b", "A", "B", "1", "_"];

/** Every string of up to `maxLength` characters over the alphabet. */
function* strings(maxLength: number): Generator<string> {
  let layer = [""];
  yield "";
  for (let length = 1; length <= maxLength; length++) {
    layer = layer.flatMap((prefix) => alphabet.map((each) => prefix + each));
    yield* layer;
  }
}

// A name can come from a request (an error added under a submitted key), so humanizing it must not
// take time that grows with the square of its length: the old rule took about 6 s for 100,000
// characters, and this takes about a millisecond (#116).
const LIMIT_MS = 250;

function milliseconds(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe("underscore", () => {
  test.each([
    ["digits", "0"],
    ["capitals", "A"],
  ])("takes linear time on a long run of %s", (_, character) => {
    const name = character.repeat(100_000);

    expect(milliseconds(() => underscore(name))).toBeLessThan(LIMIT_MS);
  });

  test("humanizes an error's long attribute name in linear time", () => {
    const user = users.build({ id: 1 });
    user.errors.add("0".repeat(100_000), "is bad");

    expect(milliseconds(() => user.errors.fullMessages())).toBeLessThan(LIMIT_MS);
  });

  test("gives the names Rails' rule gives, for every short string", () => {
    const different: string[] = [];
    for (const name of strings(7)) {
      if (underscore(name) !== originalUnderscore(name)) different.push(name);
      if (different.length === 5) break;
    }

    expect(different).toEqual([]);
  });
});
