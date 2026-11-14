import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { attempt, Sample } from "../support/attribute-samples.ts";
import { PURE_RUNS } from "../support/properties.ts";

// A cell in the form datetimes are stored in (`2026-01-02T03:04:05.678Z`) is read with one Date
// when `toISOString` writes that same text back, and otherwise is read as an assigned value would
// be cast, which refuses a day that doesn't exist (#216).

/** `count` digits, any of them, so the calendar can be wrong in every field. */
const digits = (count: number) =>
  fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: count, maxLength: count })
    .map((each) => each.join(""));

/** A two-digit field, often at the edge of its range. */
const field = (edges: number[]) =>
  fc.oneof(
    digits(2),
    fc.constantFrom(...edges).map((value) => String(value).padStart(2, "0")),
  );

const storedText = fc
  .record({
    year: fc.oneof(digits(4), fc.constantFrom("2024", "2026", "2100", "2000", "0000", "9999")),
    month: field([0, 1, 2, 4, 12, 13]),
    day: field([0, 1, 28, 29, 30, 31, 32]),
    hour: field([0, 23, 24, 25]),
    minute: field([0, 59, 60]),
    second: field([0, 59, 60]),
    millis: digits(3),
  })
  .map(
    (at) => `${at.year}-${at.month}-${at.day}T${at.hour}:${at.minute}:${at.second}.${at.millis}Z`,
  );

const stamp = Sample.typeForAttribute("stamp");

/** Whether `toISOString` writes `text` back for the date it parses to. */
function isRoundTrip(text: string): boolean {
  const date = new Date(text);
  return !Number.isNaN(date.getTime()) && date.toISOString() === text;
}

/** Text `toISOString` writes, mostly: a real date's, or digits that happen to name one. */
const writtenText = fc.oneof(
  {
    arbitrary: fc
      .date({
        min: new Date("0000-01-01"),
        max: new Date("9999-12-31T23:59:59.999Z"),
        noInvalidDate: true,
      })
      .map((date) => date.toISOString()),
    weight: 4,
  },
  { arbitrary: storedText, weight: 1 },
);

describe("reading a datetime cell in the stored form", () => {
  test("gives the instant the text names when toISOString writes it back", () => {
    fc.assert(
      fc.property(writtenText, (text) => {
        fc.pre(isRoundTrip(text));

        expect(stamp.deserialize(text)).toEqual(new Date(text));
      }),
      PURE_RUNS,
    );
  });

  test("gives what casting gives when toISOString writes other text", () => {
    fc.assert(
      fc.property(storedText, (text) => {
        fc.pre(!isRoundTrip(text));
        const read = attempt(() => stamp.deserialize(text));
        const cast = attempt(() => stamp.cast(text));

        expect(read.ok).toBe(cast.ok);
        if (read.ok && cast.ok) expect(read.value).toEqual(cast.value);
      }),
      PURE_RUNS,
    );
  });
});
