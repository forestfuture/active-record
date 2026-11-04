import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { readValue, writeValue } from "../../packages/active-record/src/conversion.ts";
import { PURE_RUNS } from "../support/properties.ts";

// A datetime stored as a Unix epoch (#73) keeps the instant to the unit it's stored in: a stored
// integer is always a safe whole number, and reading it back never moves the instant later.
const dates = fc.date({ min: new Date(-8.64e12), max: new Date(8.64e12), noInvalidDate: true });

const seconds = { type: "datetime", storage: "unixSeconds" } as const;
const milliseconds = { type: "datetime", storage: "unixMilliseconds" } as const;

describe("a datetime stored as an epoch", () => {
  test("milliseconds keep the instant exactly, as an integer", () => {
    fc.assert(
      fc.property(dates, (date) => {
        const stored = writeValue(milliseconds, date);

        expect(Number.isSafeInteger(stored)).toBe(true);
        expect((readValue(milliseconds, stored) as Date).getTime()).toBe(date.getTime());
      }),
      PURE_RUNS,
    );
  });

  test("seconds keep the instant to the second, never later than it", () => {
    fc.assert(
      fc.property(dates, (date) => {
        const stored = writeValue(seconds, date);
        const back = (readValue(seconds, stored) as Date).getTime();

        expect(Number.isSafeInteger(stored)).toBe(true);
        expect(back).toBeLessThanOrEqual(date.getTime());
        expect(date.getTime() - back).toBeLessThan(1000);
        expect(Math.abs(back % 1000)).toBe(0); // a whole second (a remainder can be -0)
      }),
      PURE_RUNS,
    );
  });
});
