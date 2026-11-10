import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { parseJsonc } from "../../packages/active-record/cli/project/config-file.ts";
import { PURE_RUNS } from "../support/properties.ts";

/** Any Unicode character, often one of JSON's own punctuation or whitespace. */
const anyChar = fc.oneof(
  fc.constantFrom(",", "}", "]", "{", "[", ":", '"', "\\", "/", "*", " ", "\n", "\r", "\t"),
  fc.string({ unit: "binary", minLength: 1, maxLength: 1 }),
);

/** Any text, for strings and comments. */
const anyText = fc.string({ unit: anyChar });

/** Whitespace, a line comment or a block comment, as a person might put between two tokens. */
const filler = fc.oneof(
  fc.constantFrom(" ", "\n", "\r\n", "\t"),
  anyText.map((text) => `//${text.replaceAll("\n", " ")}\n`),
  anyText.map((text) => `/*${text.replaceAll("*/", "* /")}*/`),
);

/** A line comment the file ends with, with no newline after it, or none. */
const lastLine = fc.option(
  anyText.map((text) => `//${text.replaceAll("\n", " ")}`),
  {
    nil: "",
  },
);

/** Any JSON value, with any Unicode in its strings and keys. */
const anyJson = fc.jsonValue({ stringUnit: anyChar });

/** Up to two fillers, as a person might put between two tokens. */
const gap = (g: fc.GeneratorValue) => g(fc.array, filler, { maxLength: 2 }).join("");

/** `value` written as JSON, with filler between its tokens and, at random, trailing commas. */
function asJsonc(value: unknown, g: fc.GeneratorValue): string {
  const bracketed = (open: string, items: string[], close: string) => {
    if (items.length === 0) return `${open}${gap(g)}${close}`;
    const trailing = g(fc.boolean) ? `,${gap(g)}` : "";
    return `${open}${items.map((item) => `${gap(g)}${item}${gap(g)}`).join(",")}${trailing}${close}`;
  };
  if (Array.isArray(value))
    return bracketed(
      "[",
      value.map((item) => asJsonc(item, g)),
      "]",
    );
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const entries = Object.entries(value);
  return bracketed(
    "{",
    entries.map(([key, item]) => `${JSON.stringify(key)}${gap(g)}:${gap(g)}${asJsonc(item, g)}`),
    "}",
  );
}

/** A whole file: `value` as JSONC, with filler before and after it, and maybe a last line comment. */
function asJsoncFile(value: unknown, g: fc.GeneratorValue): string {
  return `${gap(g)}${asJsonc(value, g)}${gap(g)}${g(() => lastLine)}`;
}

// Whatever a person writes in active-record.jsonc reads as JSON.parse reads it without comments (#308).
describe("JSON with comments and trailing commas, for any value", () => {
  test("any JSON, with comments and trailing commas added, reads as JSON.parse reads it", () => {
    fc.assert(
      fc.property(anyJson, fc.gen(), (value, g) => {
        expect(parseJsonc(asJsoncFile(value, g))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
      PURE_RUNS,
    );
  });
});
