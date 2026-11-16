import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { PURE_RUNS } from "../support/properties.ts";

/** A Model whose one decimal has `scale`, for each scale tried. */
const scaled = Array.from(
  { length: 7 },
  (_, scale) =>
    class extends Model.define({ id: "integer", n: { type: "decimal", scale } }) {
      static table = "samples";
    },
);

/** Decimal text: a sign, up to 20 whole digits, and up to 12 after the point. */
const decimalText = fc
  .tuple(fc.boolean(), fc.bigInt({ min: 0n, max: 10n ** 20n }), fc.stringMatching(/^\d{0,12}$/))
  .map(
    ([negative, whole, fraction]) =>
      `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`,
  );

/** `text` as a whole number of `10 ** -places`: `"-1.5"` at 2 places is -150n. */
function scaledBy(text: string, places: number): bigint {
  const negative = text.startsWith("-");
  const [whole = "", fraction = ""] = text.replace("-", "").split(".");
  const units = BigInt(whole + fraction.padEnd(places, "0").slice(0, places));
  return negative ? -units : units;
}

// A scale rounds assigned text half away from zero, as Postgres's numeric does (#398). Checked
// against BigInt arithmetic, apart from the library's string rounding.
describe("rounding a decimal to its scale", () => {
  test("keeps at most the scale's places, nearest the value, a half away from zero", () => {
    fc.assert(
      fc.property(decimalText, fc.integer({ min: 0, max: 6 }), (text, scale) => {
        const rounded = scaled[scale]!.build({ n: text }).n!;
        const places = 18;
        const difference = scaledBy(rounded, places) - scaledBy(text, places);
        const half = 5n * 10n ** BigInt(places - scale - 1);

        expect(rounded.split(".")[1]?.length ?? 0).toBeLessThanOrEqual(scale);
        expect(difference <= half && difference >= -half).toBe(true);
        const awayFromZero = text.startsWith("-") ? difference < 0n : difference > 0n;
        if (difference === half || difference === -half) expect(awayFromZero).toBe(true);
      }),
      PURE_RUNS,
    );
  });

  test("a rounded value rounds to itself", () => {
    fc.assert(
      fc.property(decimalText, fc.integer({ min: 0, max: 6 }), (text, scale) => {
        const Sample = scaled[scale]!;
        const rounded = Sample.build({ n: text }).n!;

        expect(Sample.build({ n: rounded }).n).toBe(rounded);
      }),
      PURE_RUNS,
    );
  });
});
