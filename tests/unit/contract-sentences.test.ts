import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

// docs/contract.md holds one sentence per line, so two issues that change one bullet touch different
// lines, and a rebase merges them without a conflict (#620).
const contract = readFileSync(new URL("../../docs/contract.md", import.meta.url), "utf8");

/** Words a period follows mid-sentence. */
const abbreviations = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf)\.$/;

/**
 * Where a line's prose breaks between sentences: after a period, ! or ?, and any closing ) " ' _ or `,
 * at a space before a capital, a backtick, an underscore, a ( or a [. A code span's inside is skipped.
 */
function sentenceBreaks(line: string): string[] {
  const prose = line.replace(/`[^`]*`/g, (span) => `\`${"x".repeat(span.length - 2)}\``);
  const breaks: string[] = [];
  for (const match of prose.matchAll(/[.!?][)"'_`]*( +)(?=[A-Z`_([])/g)) {
    const end = match.index + match[0].length - match[1]!.length;
    if (abbreviations.test(prose.slice(0, end))) continue;
    breaks.push(line.slice(Math.max(0, end - 30), end + 30));
  }
  return breaks;
}

/** The contract's prose lines: not inside a code block, and not a table row. */
function proseLines(): Array<{ number: number; line: string }> {
  let inCode = false;
  return contract.split("\n").flatMap((line, index) => {
    if (/^\s*```/.test(line)) inCode = !inCode;
    if (inCode || /^\s*\|/.test(line)) return [];
    return [{ number: index + 1, line }];
  });
}

describe("docs/contract.md", () => {
  test("holds one sentence per line", () => {
    const joined = proseLines().flatMap(({ number, line }) =>
      sentenceBreaks(line).map((around) => `line ${number}: …${around}…`),
    );

    expect(joined).toEqual([]);
  });

  test("finds a second sentence on a line, and leaves an abbreviation or a code span alone", () => {
    expect(sentenceBreaks("One thing. Another (#1).")).toHaveLength(1);
    expect(sentenceBreaks("- It reads `a. B`, e.g. Postgres, and `x`. `y` follows.")).toHaveLength(
      1,
    );
    expect(sentenceBreaks("_Portable._ A bullet marked (D1) is D1's.")).toHaveLength(1);
    expect(sentenceBreaks("Ends here (see #2). _Code:_ `a.ts`.")).toHaveLength(1);
  });
});
