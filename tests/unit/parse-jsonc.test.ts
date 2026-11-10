import { describe, expect, test } from "vite-plus/test";
import { parseJsonc } from "../../packages/active-record/cli/project/config-file.ts";

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
});
