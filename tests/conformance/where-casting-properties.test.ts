import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Model } from "../../src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { SLOW_RUNS, SLOW_TIMEOUT } from "../support/properties.ts";
import { values } from "../support/values.ts";

class Sample extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
}) {
  static table = "samples";
}

const attributes = ["label", "quantity", "ratio", "enabled", "stamp"] as const;
type Attribute = (typeof attributes)[number];

// A condition's value comes from outside too (a query string, a JSON body): for a value of any
// shape, `where` finds the rows that match its cast, or none, and never fails in some other way
// (#81, #122).
describe("where, for a value of any shape", { timeout: SLOW_TIMEOUT }, () => {
  let harness: Harness;
  const samples = () => harness.connect().model(Sample);

  beforeAll(async () => {
    harness = await openHarness();
    await harness.reset("samples");
    await harness.exec(`INSERT INTO samples (id, label, quantity, ratio, enabled, stamp) VALUES
        (1, '1', 1, 1.5, 1, '2026-01-01T00:00:00.000Z'),
        (2, 'true', 0, 0, 0, '2026-01-02T00:00:00.000Z'),
        (3, '', 42, 2, 1, NULL),
        (4, NULL, NULL, NULL, NULL, NULL)`);
  });
  afterAll(() => harness.dispose());

  /** What assigning `value` gives, or that it was refused: the cast a condition shares. */
  function assigned(attribute: Attribute, value: unknown): { value: unknown } | "refused" {
    try {
      return { value: samples().build({ [attribute]: value as never })[attribute] };
    } catch {
      return "refused";
    }
  }

  const anyAttribute = fc.constantFrom(...attributes);

  test("is a TypeError only for undefined, which it names", async () => {
    await fc.assert(
      fc.asyncProperty(anyAttribute, values, async (attribute, value) => {
        try {
          await samples()
            .where({ [attribute]: value as never })
            .toArray();
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
          expect((error as TypeError).message).toMatch(
            new RegExp(`^where\\(\\) got undefined for "${attribute}"; use null`),
          );
        }
      }),
      SLOW_RUNS,
    );
  });

  test("matches nothing for a single value that can't be cast", async () => {
    const single = values.filter((value) => !Array.isArray(value) && value !== undefined);

    await fc.assert(
      fc.asyncProperty(anyAttribute, single, async (attribute, value) => {
        // A finite number is also matched against a text attribute as its digits.
        fc.pre(!(attribute === "label" && typeof value === "number" && Number.isFinite(value)));
        fc.pre(assigned(attribute, value) === "refused");

        const rows = await samples()
          .where({ [attribute]: value as never })
          .toArray();

        expect(rows).toEqual([]);
      }),
      SLOW_RUNS,
    );
  });

  test("matches only rows holding the cast value", async () => {
    const single = values.filter((value) => !Array.isArray(value) && value !== undefined);

    await fc.assert(
      fc.asyncProperty(anyAttribute, single, async (attribute, value) => {
        const cast = assigned(attribute, value);
        fc.pre(cast !== "refused" && cast.value !== null);

        const rows = await samples()
          .where({ [attribute]: value as never })
          .toArray();

        const expected = (cast as { value: unknown }).value;
        // A date by its time, and a number without its sign of zero: -0 is the stored 0.
        const comparable = (held: unknown) =>
          held instanceof Date ? held.getTime() : typeof held === "number" ? held + 0 : held;
        for (const row of rows) {
          expect(comparable(row[attribute])).toEqual(comparable(expected));
        }
      }),
      SLOW_RUNS,
    );
  });
});
