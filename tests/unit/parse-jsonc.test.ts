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
function written(value: unknown, g: fc.GeneratorValue): string {
  const gap = () => g(fc.array, filler, { maxLength: 2 }).join("");
  const list = (open: string, items: string[], close: string) => {
    const trailing = items.length > 0 && g(fc.boolean) ? `,${gap()}` : "";
    return `${open}${items.map((item) => `${gap()}${item}${gap()}`).join(",")}${trailing}${close}`;
  };
  if (Array.isArray(value))
    return list(
      "[",
      value.map((item) => written(item, g)),
      "]",
    );
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const entries = Object.entries(value);
  return list(
    "{",
    entries.map(([key, item]) => `${JSON.stringify(key)}${gap()}:${gap()}${written(item, g)}`),
    "}",
  );
}

// active-record.jsonc is JSON with comments and trailing commas, read as a person wrote it (#308).
describe("reading JSON with comments and trailing commas", () => {
  test("a string holding a comma before } or ] reads as written", () => {
    expect(parseJsonc('{ "a": "x,]", "b": "y, }", "c": ["z,\\"]"] }')).toEqual({
      a: "x,]",
      b: "y, }",
      c: ['z,"]'],
    });
  });

  test("a trailing comma before a comment is dropped", () => {
    expect(parseJsonc('{ "a": [1, /* c */ ], "b": 2, // c\n}')).toEqual({ a: [1], b: 2 });
  });

  // Each } or ] is read once, never by going back over the text before it.
  test("a long run of closing brackets takes no time", () => {
    const text = `[${"[1,],".repeat(100_000)}1]`;
    const started = performance.now();

    expect(parseJsonc(text)).toHaveLength(100_001);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("any JSON, with comments and trailing commas added, reads as JSON.parse reads it", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.gen(), (value, g) => {
        expect(parseJsonc(written(value, g))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
      PURE_RUNS,
    );
  });
});
