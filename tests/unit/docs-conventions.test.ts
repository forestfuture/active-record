import { describe, expect, test } from "vite-plus/test";
import { guidePages } from "../support/guide-pages.ts";

const pages = guidePages();

/** What a code span becomes in prose, so a list can still count it as an item. */
const code = "CODE";

/** A list's item: a code span, or one word after an optional article or possessive. */
const item = String.raw`(?:(?:a|an|the|its|their|your) )?[\w’'-]+`;

/**
 * A list of three or more items whose last is joined by "and" or "or" without a comma before it.
 * A list of words starts at a line's start or after punctuation, so a clause before a comma
 * (“In a Model, `a` and `b`”) isn't one of its items. A code span can start one anywhere.
 */
const listWithoutComma = new RegExp(
  String.raw`(?:\b${code}|(?<![\w’'-] )\b${item})(?:, ${item})+ (?:and|or) ${item}`,
  "g",
);

/** How every comparison box opens: Blume's info callout, with the Ruby icon beside its title. */
const railsBox = /^<Callout type="info" title="(Compared with|Beyond) Rails" icon="\/ruby\.svg">$/;

/**
 * A page's prose: without front matter, fenced code, inline code, links' targets, HTML and JSX,
 * a component's props across lines included (`<TypeTable type={{ … }} />`).
 */
function prose(text: string): string[] {
  const lines: string[] = [];
  let fenced = false;
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^<[A-Z]\w*\n[\s\S]*?\/>$/gm, "");
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    else if (!fenced) {
      lines.push(
        line
          .replace(/`[^`]*`/g, code)
          .replace(/\]\([^)]*\)/g, "]")
          .replace(/<[^>]*>/g, ""),
      );
    }
  }
  return lines;
}

/** The lists in a line of prose that leave out the Oxford comma, with code spans as `CODE`. */
function missingOxfordCommas(line: string): string[] {
  const plain = line.replace(/`[^`]*`/g, code).replace(/[*[\]]/g, "");
  return [...plain.matchAll(listWithoutComma)].map(([list]) => list);
}

// The guide's conventions that a tool can check (docs/agents/docs-voice.md).
describe("the guide's pages", () => {
  test("show comparison boxes as info callouts with the Ruby icon", () => {
    const boxes = pages.flatMap(({ name, text }) =>
      text
        .split("\n")
        .filter((line) => /(Compared with|Beyond) Rails["\]]/.test(line))
        .map((line) => ({ name, line })),
    );
    const other = boxes.filter(({ line }) => !railsBox.test(line));

    expect(boxes.length).toBeGreaterThan(20);
    expect(other.map(({ name, line }) => `${name}: ${line}`)).toEqual([]);
  });

  test("never escape a brace, which agents would read in the page's Markdown", () => {
    const escaped = pages.flatMap(({ name, text }) =>
      prose(text)
        .filter((line) => line.includes("\\{"))
        .map((line) => `${name}: ${line.trim()}`),
    );

    expect(escaped).toEqual([]);
  });

  test("include examples as partials, so agents never get a Twoslash fence's hidden files", () => {
    const hidden = pages.flatMap(({ name, text }) =>
      [...text.matchAll(/twoslash\.ts|@filename/g)].map(([match]) => `${name}: ${match}`),
    );

    expect(hidden).toEqual([]);
  });

  test("use smart quotes and apostrophes in prose", () => {
    const straight = pages.flatMap(({ name, text }) =>
      prose(text)
        .filter((line) => /["']/.test(line))
        .map((line) => `${name}: ${line.trim()}`),
    );

    expect(straight).toEqual([]);
  });
});

describe("the Oxford comma check", () => {
  test("flags a list of three or more without a comma before its last item", () => {
    expect(missingOxfordCommas("Use `rewhere`, `unscope` and `only` instead.")).toEqual([
      "CODE, CODE and CODE",
    ]);
    expect(missingOxfordCommas("Use `rewhere`, `unscope`, and `only` instead.")).toEqual([]);
  });
});
