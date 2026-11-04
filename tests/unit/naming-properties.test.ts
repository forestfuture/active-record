import fc from "fast-check";
import { describe, test } from "vite-plus/test";
import { camelize, underscore } from "../../packages/active-record/src/naming.ts";
import { originalUnderscore } from "../support/naming-oracle.ts";
import { SLOW_RUNS, PURE_RUNS } from "../support/properties.ts";

// Names reach these functions from a request (an error added under a submitted key), so they're
// checked on strings nobody wrote by hand: ones built from the characters the rules look at, and
// ones of any UTF-16 code unit, lone surrogates included (#122).
const ruleCharacters = fc.string({
  unit: fc.constantFrom("a", "b", "z", "A", "B", "Z", "0", "9", "_", "-", " "),
  maxLength: 60,
});
const anyCharacters = fc.string({ unit: "binary", maxLength: 60 });
const names = fc.oneof(ruleCharacters, anyCharacters);

const runs = PURE_RUNS;

describe("underscore, for any name", () => {
  test("gives the names the original two-rule definition gives", () => {
    fc.assert(
      fc.property(names, (name) => underscore(name) === originalUnderscore(name)),
      runs,
    );
  });

  test("gives lowercase", () => {
    fc.assert(
      fc.property(names, (name) => underscore(name) === underscore(name).toLowerCase()),
      runs,
    );
  });

  test("leaves a name it has already converted as it is", () => {
    fc.assert(
      fc.property(names, (name) => {
        const column = underscore(name);
        return underscore(column) === column;
      }),
      runs,
    );
  });

  // Names the 60-character ones don't reach: a long run of one kind of character is what made the
  // old rule quadratic (#116). The original rule is slow on it, so fewer and shorter than 100,000.
  test("gives what the original rule gives, for names of up to 2,000 characters", () => {
    const longNames = fc.string({
      unit: fc.constantFrom("a", "A", "B", "0", "_"),
      minLength: 200,
      maxLength: 2000,
    });

    fc.assert(
      fc.property(longNames, (name) => underscore(name) === originalUnderscore(name)),
      SLOW_RUNS,
    );
  });
});

/** The rule read one character at a time: an underscore before a lowercase letter or digit goes. */
function camelizedByHand(name: string): string {
  let result = "";
  for (let index = 0; index < name.length; index++) {
    const next = name[index + 1];
    if (name[index] === "_" && next !== undefined && /[a-z\d]/.test(next)) {
      result += next.toUpperCase();
      index++;
    } else {
      result += name[index];
    }
  }
  return result;
}

describe("camelize, for any name", () => {
  test("drops each underscore that comes before a lowercase letter or digit, and no other", () => {
    fc.assert(
      fc.property(names, (name) => camelize(name) === camelizedByHand(name)),
      runs,
    );
  });

  test("never makes the name longer", () => {
    fc.assert(
      fc.property(names, (name) => camelize(name).length <= name.length),
      runs,
    );
  });
});
