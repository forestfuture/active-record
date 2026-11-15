import { describe, expect, test } from "vite-plus/test";
import { InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

// connect() never touches the binding until a query runs, and these tests run none.
const db = connect({} as never);

/** A Model whose one attribute has `spec`, past the types, as plain JavaScript could declare it. */
const withSpec = (spec: unknown) =>
  class Sample extends Model.define({ id: "integer", value: spec as never }) {
    static override table = "samples";
  };

describe("an enum's declaration, past the types (#340)", () => {
  test.each([
    [
      { type: "integer", enum: ["low"] },
      'Sample.value is "integer", so its enum gives each name the integer it\'s stored as, not a list of names',
    ],
    [
      { type: "integer", enum: { low: "l" } },
      'Sample.value is "integer", so its enum stores integers, not "l" for "low"',
    ],
    [
      { type: "integer", enum: { low: 1.5 } },
      'Sample.value is "integer", so its enum stores integers, not 1.5 for "low"',
    ],
    [
      { type: "string", enum: { draft: 0 } },
      'Sample.value is "string", so its enum stores text, not 0 for "draft"',
    ],
    [{ type: "string", enum: [] }, "Sample.value has an enum with no names; give it at least one"],
    [{ type: "string", enum: ["a", "a"] }, 'Sample.value\'s enum names "a" twice'],
    [
      { type: "integer", enum: { low: 0, none: 0 } },
      'Sample.value\'s enum stores 0 for both "low" and "none"',
    ],
    [
      { type: "string", enum: "draft" },
      'Sample.value has an enum "draft"; give it a list of names, or an object of names and the values they\'re stored as',
    ],
    [
      { type: "string", prefix: true },
      "Sample.value has a prefix but no enum; give it an enum, or remove a prefix",
    ],
    [
      { type: "string", enum: ["a"], suffix: "" },
      'Sample.value has a suffix ""; use true for the attribute\'s name, or a word',
    ],
    [
      { type: "boolean", enum: { on: 1 } },
      'Sample.value is "boolean", so it can\'t have an enum: an enum is stored as text or integers',
    ],
  ])("%j is an InvalidModel", (spec, message) => {
    expect(() => db.model(withSpec(spec)).build()).toThrow(new InvalidModel(message));
  });
});
