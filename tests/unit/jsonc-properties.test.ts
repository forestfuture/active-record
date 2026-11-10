import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { parseJsonc } from "../../packages/active-record/cli/project/config-file.ts";
import { PURE_RUNS } from "../support/properties.ts";

/** Whitespace, a line comment or a block comment, as a person might put between two tokens. */
const filler = fc.oneof(
  fc.constantFrom(" ", "\n", "\r\n", "\t"),
  fc.string().map((text) => `//${text.replaceAll("\n", " ")}\n`),
  fc.string().map((text) => `/*${text.replaceAll("*/", "* /")}*/`),
);

/** `value` written as JSON, with filler between its tokens and, at random, trailing commas. */
function asJsonc(value: unknown, g: fc.GeneratorValue): string {
  const gap = () => g(fc.array, filler, { maxLength: 2 }).join("");
  const bracketed = (open: string, items: string[], close: string) => {
    const trailing = items.length > 0 && g(fc.boolean) ? `,${gap()}` : "";
    return `${open}${items.map((item) => `${gap()}${item}${gap()}`).join(",")}${trailing}${close}`;
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
    entries.map(([key, item]) => `${JSON.stringify(key)}${gap()}:${gap()}${asJsonc(item, g)}`),
    "}",
  );
}

// active-record.jsonc is JSON with comments and trailing commas, read as a person wrote it (#308).
describe("reading JSON with comments and trailing commas", () => {
  test("any JSON, with comments and trailing commas added, reads as JSON.parse reads it", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.gen(), (value, g) => {
        expect(parseJsonc(asJsonc(value, g))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
      PURE_RUNS,
    );
  });
});
