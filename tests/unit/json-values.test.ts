import { describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

class Doc extends Model.define({
  id: { type: "integer", null: false },
  settings: "json",
  secret: "json",
}) {
  static table = "json_docs";
  static override filterAttributes = ["secret"];
}

// No D1 needed: assigning casts and never queries.
const docs = connect({} as never).model(Doc);

const cycle: Record<string, unknown> = {};
cycle.self = cycle;

/** A value JSON can't write, and how an error shows it. */
const unwritable: [string, unknown, string][] = [
  ["a BigInt", 10n, "10"],
  ["a cycle", cycle, "[object Object]"],
  ["a function", () => 1, "() => 1"],
  ["a symbol", Symbol("s"), "Symbol(s)"],
];

/** Every way a value reaches a `json` attribute without a query (#146). */
const paths: [string, (value: unknown) => unknown][] = [
  ["build", (value) => docs.build({ settings: value as never })],
  ["assign", (value) => docs.build().assign({ settings: value as never })],
  [
    "a property setter",
    (value) => {
      docs.build().settings = value as never;
    },
  ],
  ["permit", (value) => Doc.permit({ settings: value }, "settings")],
  ["a Relation's build", (value) => docs.where({ id: 1 }).build({ settings: value as never })],
];

describe("a value JSON can't write, assigned to a json attribute (#146)", () => {
  describe.each(paths)("through %s", (_path, assign) => {
    test.each(unwritable)(
      "%s throws TypeError naming the Model and attribute",
      (_kind, value, shown) => {
        expect(() => assign(value)).toThrow(
          new TypeError(`Doc: ${shown} isn't a JSON value for "settings"`),
        );
      },
    );
  });

  test("the attribute keeps its value when an assignment is refused", () => {
    const doc = docs.build({ settings: { a: 1 } });

    expect(() => doc.assign({ settings: 10n as never })).toThrow(TypeError);

    expect(doc.settings).toEqual({ a: 1 });
  });

  test("a filtered attribute's value is hidden in the error", () => {
    expect(() => docs.build({ secret: 10n as never })).toThrow(
      new TypeError(`Doc: [FILTERED] isn't a JSON value for "secret"`),
    );
  });

  test("an array holding one is refused as a whole", () => {
    expect(() => docs.build({ settings: [1, 10n] as never })).toThrow(
      new TypeError(`Doc: 1,10 isn't a JSON value for "settings"`),
    );
  });

  test("undefined still says to use null", () => {
    expect(() => docs.build({ settings: undefined as never })).toThrow(
      /got undefined for "settings"; use null to store NULL/,
    );
  });
});
