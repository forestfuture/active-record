import { describe, expect, test } from "vite-plus/test";
import { guidePages } from "../support/guide-pages.ts";

const pages = guidePages();

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
          .replace(/`[^`]*`/g, "")
          .replace(/\]\([^)]*\)/g, "]")
          .replace(/<[^>]*>/g, ""),
      );
    }
  }
  return lines;
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
