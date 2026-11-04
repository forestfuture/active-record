import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { column, Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/d1-record/src/index.ts";
import { fragment } from "../support/fragments.ts";
import { PURE_RUNS } from "../support/properties.ts";
import { values } from "../support/values.ts";

// What a fragment is given comes from outside, so the guard (#149) must judge any value: refuse
// exactly a Date or an ISO datetime string beside an integer-stored column, and nothing else.
class Stamp extends Model.define({
  id: { type: "integer", null: false },
  seconds: { type: "datetime", storage: "unixSeconds" },
  iso: "datetime",
}) {
  static table = "stamps";
}

// No D1 needed: building a Relation never queries.
const stamps = connect({} as never).model(Stamp);
const operators = ["=", "==", "<>", "!=", "<", "<=", ">", ">="];

/** `column <operator> value`, built from its pieces so the operator can vary. */
function comparing(attribute: string, operator: string, value: unknown) {
  return fragment(["", ` ${operator} `, ""], column(attribute), value);
}

/** An ISO date, or a date and time with or without a zone (SQLite writes it without one). */
const dateText =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Whether a value is one the guard should refuse beside an integer column: a Date, or a string
 * that's date text. Written out here, not from the implementation, so it can disagree with it.
 */
function isBareDatetime(value: unknown): boolean {
  return value instanceof Date || (typeof value === "string" && dateText.test(value));
}

/** Every shape of value, and date text in the forms a request or SQLite makes. */
const anyValue = fc.oneof(
  values,
  fc.date({ noInvalidDate: true }).map((date) => date.toISOString()),
  fc
    .date({ noInvalidDate: true })
    .map((date) => date.toISOString().replace("T", " ").replace("Z", "")),
  fc.date({ noInvalidDate: true }).map((date) => date.toISOString().slice(0, 10)),
);

describe("the bare date guard, for a value of any shape", () => {
  test("refuses exactly a Date or an ISO datetime string beside an integer-stored column", () => {
    fc.assert(
      fc.property(fc.constantFrom(...operators), anyValue, (operator, value) => {
        const refused = (() => {
          try {
            stamps.where(comparing("seconds", operator, value));
            return false;
          } catch (error) {
            return error instanceof TypeError;
          }
        })();

        expect(refused).toBe(isBareDatetime(value));
      }),
      PURE_RUNS,
    );
  });

  test("never refuses a value beside an attribute that isn't integer-stored", () => {
    fc.assert(
      fc.property(fc.constantFrom(...operators), values, (operator, value) => {
        expect(() => stamps.where(comparing("iso", operator, value))).not.toThrow();
      }),
      PURE_RUNS,
    );
  });
});
