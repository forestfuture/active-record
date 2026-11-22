// The conventions in docs/agents/docs-voice.md that a tool can check, in the guide and the READMEs.

import { describe, expect, test } from "vite-plus/test";
import { guidePages, readmes } from "../support/guide-pages.ts";

const pages = guidePages();

/** A list's item: a code span, or one word after an optional article or possessive. */
const listItem = String.raw`(?:\`[^\`]*\`|(?:(?:a|an|the|its|their|your) )?[\w’'-]+)`;

/**
 * A list of three or more items whose last is joined by "and" or "or" without a comma before it.
 * A list of words starts at a line's start or after punctuation, so a clause before a comma
 * (“In a Model, `a` and `b`”) isn't one of its items. A code span can start one anywhere.
 */
const listWithoutComma = new RegExp(
  String.raw`(?:(?=\`)|(?<![\w’'\`-] )\b)${listItem}(?:, ${listItem})+ (?:and|or) ${listItem}`,
  "g",
);

/** How every comparison box opens: Blume's info callout, with the Ruby icon beside its title. */
const railsBox = /^<Callout type="info" title="(Compared with|Beyond) Rails" icon="\/ruby\.svg">$/;

/**
 * A page's prose: without front matter, fenced code, links' targets, HTML and JSX, a component's
 * props across lines included (`<TypeTable type={{ … }} />`). Inline code is dropped, or kept
 * whole with `keepCode`, the link and HTML strips never reaching inside it.
 */
function prose(text: string, keepCode = false): string[] {
  const lines: string[] = [];
  let fenced = false;
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^<[A-Z]\w*\n[\s\S]*?\/>$/gm, "");
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    else if (!fenced) {
      lines.push(
        line.replace(/`[^`]*`|\]\([^)]*\)|<[^>]*>/g, (found) => {
          if (found.startsWith("`")) return keepCode ? found : "";
          return found.startsWith("]") ? "]" : "";
        }),
      );
    }
  }
  return lines;
}

/** The lists in a line of prose that leave out the Oxford comma. */
function missingOxfordCommas(line: string): string[] {
  const plain = line.replace(/[*[\]]/g, "");
  return [...plain.matchAll(listWithoutComma)].map(([list]) => list);
}

/** A page's prose, with its front matter's description, which is shown as prose too. */
function proseWithDescription(text: string): string[] {
  const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  const description = /^description: (.*)$/m.exec(frontMatter)?.[1];
  return [...(description === undefined ? [] : [description]), ...prose(text, true)];
}

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

/**
 * Lists the check reads wrongly, by page and match: a noun and a phrase describing it, or a
 * clause before the comma, rather than a list.
 */
const notLists = new Set([
  "(basics)/associations.mdx: `deleteAll`, alone or in", // the writes, alone or in `db.batch`
  "(basics)/persistence.mdx: record, persisted or not", // a record, whether persisted or not
  "(background)/query-databases.md: `onQuery`, app-wide or per", // `onQuery`, either app-wide or per request
  "(how-to)/console.mdx: `y`, cancels and opens", // “Anything else, including `y`,” is the subject
  "(how-to)/generators.mdx: `--id integer`, a record and the records", // “With `--id integer`,” opens the sentence
  "README.md: `select`, `distinct`, `pluck`, `pick`, `ids`, `sole`, `count` and the other", // “`count` and the other calculations” is one item
  "README.md: `having`, `size`, `exists`, `hasMoreThanOne`, named and default", // “named and default scopes” is one item
]);

describe("the guide's pages and the READMEs", () => {
  test("use the Oxford comma in lists of three or more", () => {
    const missing = [...pages, ...readmes()].flatMap(({ name, text }) =>
      proseWithDescription(text)
        .flatMap(missingOxfordCommas)
        .map((list) => `${name}: ${list}`)
        .filter((found) => !notLists.has(found)),
    );

    expect(missing).toEqual([]);
  });
});

describe("the Oxford comma check", () => {
  test("flags a list of three or more without a comma before its last item", () => {
    expect(missingOxfordCommas("Use `rewhere`, `unscope` and `only` instead.")).toEqual([
      "`rewhere`, `unscope` and `only`",
    ]);
    expect(missingOxfordCommas("Use `rewhere`, `unscope`, and `only` instead.")).toEqual([]);
  });

  test("counts words as items when the list starts a line or follows punctuation", () => {
    expect(missingOxfordCommas("Red, green and blue.")).toEqual(["Red, green and blue"]);
    expect(missingOxfordCommas("Choose: red, green and blue.")).toEqual(["red, green and blue"]);
    expect(missingOxfordCommas("Red, green, and blue.")).toEqual([]);
    expect(missingOxfordCommas("In a Model, red and blue mix.")).toEqual([]);
  });

  test("reads a code span whole, even one holding what looks like HTML", () => {
    const [line] = prose("Set `a<b`, `c` and `d`<br>", true);

    expect(missingOxfordCommas(line ?? "")).toEqual(["`a<b`, `c` and `d`"]);
  });
});
