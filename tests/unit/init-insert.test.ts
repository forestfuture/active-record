import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { withEntries } from "../../packages/active-record/cli/init/insert.ts";
import { parseJsonc } from "../../packages/active-record/cli/project/config-file.ts";
import { PURE_RUNS } from "../support/properties.ts";

const logs = [["LOGS", { adapter: "d1" }]] as const;

// init adds a database to a file a person wrote, so the rest of it reads as they wrote it (#301).
describe("adding entries to active-record.jsonc's text", () => {
  test("a CRLF file keeps its line endings, and a comment on the last entry's line stays there", () => {
    const text = '{\r\n  "databases": {\r\n    "DB": { "adapter": "d1" } // main\r\n  }\r\n}\r\n';

    expect(withEntries(text, logs)).toBe(
      '{\r\n  "databases": {\r\n    "DB": { "adapter": "d1" }, // main\r\n    "LOGS": { "adapter": "d1" }\r\n  }\r\n}\r\n',
    );
  });

  test("a block comment on the last entry's line stays there", () => {
    const text = '{\n  "databases": {\n    "DB": { "adapter": "d1" } /* main */\n  }\n}\n';

    expect(withEntries(text, logs)).toBe(
      '{\n  "databases": {\n    "DB": { "adapter": "d1" }, /* main */\n    "LOGS": { "adapter": "d1" }\n  }\n}\n',
    );
  });

  // A line of many comments is read once through, never retried (CodeQL: inefficient regex).
  test("a long run of comments after the last entry takes no time", () => {
    const comments = `/*${"*//*".repeat(20_000)}`;
    const text = `{ "databases": { "DB": { "adapter": "d1" } ${comments}\n} }`;
    const started = performance.now();

    expect(withEntries(text, logs)).toContain('"LOGS": { "adapter": "d1" }');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  // JSON.parse, and so the command, reads the last of two keys with one name.
  test("with databases twice, the entries go in the last, which the command reads", () => {
    const text =
      '{ "databases": { "A": { "adapter": "d1" } }, "databases": { "DB": { "adapter": "d1" } } }';

    expect(parseJsonc(withEntries(text, logs)!)).toEqual({
      databases: { DB: { adapter: "d1" }, LOGS: { adapter: "d1" } },
    });
  });

  // A binding comes from another tool's config, so any name is written as a key and read back.
  test("any binding and value read back as written, beside the entries already there", () => {
    const text = '{\n  // ours\n  "databases": {\n    "DB": { "adapter": "d1" },\n  },\n}\n';
    // parseJsonc reads a comma before } or ] in a string wrongly, as it did before (#308).
    const strings = fc.string().filter((value) => !/,\s*[}\]]/.test(value));
    const entries = fc.uniqueArray(
      fc.tuple(
        strings.filter((key) => key !== "DB"),
        fc.dictionary(strings, strings, { maxKeys: 3 }),
      ),
      { minLength: 1, maxLength: 4, selector: ([key]) => key },
    );

    fc.assert(
      fc.property(entries, (added) => {
        const read = parseJsonc(withEntries(text, added)!) as { databases: object };
        expect(read).toEqual({
          databases: { DB: { adapter: "d1" }, ...Object.fromEntries(added) },
        });
      }),
      PURE_RUNS,
    );
  });
});
