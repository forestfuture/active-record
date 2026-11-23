import { describe, expect, test } from "vite-plus/test";
import { guidePages } from "../support/guide-pages.ts";

// A guide page heads each task section with a gerund ("Matching values"), as
// docs/agents/docs-pages.md says. This test checks every `##` heading in an MDX page.

/** The headings every page may have, whatever its sections. */
const fixedHeadings = new Set(["At a glance", "The Model", "The Models", "Not built yet"]);

/** Pages that aren't built of task sections, so their headings name other things. */
const exemptPages: Record<string, string> = {
  "index.mdx": "the landing page, introducing the library",
  "(adapters)/d1.mdx": "a list of how D1 differs, each heading a fact",
  "(adapters)/postgresql.mdx": "a list of how Postgres differs, each heading a fact",
  "(basics)/command-line.mdx": "a command reference, headed by each command's name",
  "(introduction)/getting-started.mdx": "a tutorial, with its prerequisites and next steps",
  "(introduction)/coming-from-rails.mdx": "a comparison, headed by each difference",
};

/** Headings that must differ on a task page, such as a reference table's, and why. */
const optOuts: { page: string; heading: string; reason: string }[] = [
  { page: "(basics)/callbacks.mdx", heading: "Callback order", reason: "a reference table" },
  {
    page: "(basics)/validations.mdx",
    heading: "Available validators",
    reason: "a reference table",
  },
  { page: "(basics)/errors.mdx", heading: "Lifecycle errors", reason: "a reference table" },
  { page: "(basics)/errors.mdx", heading: "Usage errors", reason: "a reference table" },
  { page: "(basics)/errors.mdx", heading: "Constraint errors", reason: "a reference table" },
];

const checkedPages = guidePages().filter(
  (page) => page.name.endsWith(".mdx") && !(page.name in exemptPages),
);

/** A page's `##` headings, leaving out lines inside code fences. */
function headings(text: string): string[] {
  const outsideFences = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
  return [...outsideFences.matchAll(/^## (.+)$/gm)].map((match) => match[1]!.trim());
}

function isOptedOut(page: string, heading: string): boolean {
  return optOuts.some((optOut) => optOut.page === page && optOut.heading === heading);
}

function isGerund(heading: string): boolean {
  return /^\w+ing\b/.test(heading);
}

describe("guide section headings", () => {
  test("start with a gerund", () => {
    const offending = checkedPages.flatMap((page) =>
      headings(page.text)
        .filter((heading) => !fixedHeadings.has(heading) && !isGerund(heading))
        .filter((heading) => !isOptedOut(page.name, heading))
        .map((heading) => `${page.name}: "## ${heading}"`),
    );

    expect(
      offending,
      "Head the section with a gerund, or add it to optOuts in tests/unit/docs-headings.test.ts",
    ).toEqual([]);
  });

  test("opt out only headings that are on their page", () => {
    const stale = optOuts
      .filter(({ page, heading }) => {
        const found = checkedPages.find((checked) => checked.name === page);
        return found === undefined || !headings(found.text).includes(heading);
      })
      .map(({ page, heading }) => `${page}: "## ${heading}"`);

    expect(stale).toEqual([]);
  });
});
