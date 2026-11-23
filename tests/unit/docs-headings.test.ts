import { describe, expect, test } from "vite-plus/test";
import { guidePages } from "../support/guide-pages.ts";

// A guide page heads each task section with a gerund ("Matching values"), as
// docs/agents/docs-pages.md says. This test checks every `##` heading in an MDX page.

/** The headings every page may have, whatever its sections. */
const fixedHeadings = new Set(["At a glance", "The Model", "The Models", "Not built yet"]);

/** Pages that aren't built of task sections, so their headings name other things. */
const exemptPages: { page: string; reason: string }[] = [
  { page: "index.mdx", reason: "the landing page, introducing the library" },
  { page: "(adapters)/d1.mdx", reason: "a list of how D1 differs, each heading a fact" },
  { page: "(adapters)/postgresql.mdx", reason: "a list of how Postgres differs" },
  { page: "(basics)/command-line.mdx", reason: "a command reference, headed by each command" },
  { page: "(introduction)/getting-started.mdx", reason: "a tutorial, with its next steps" },
  { page: "(introduction)/coming-from-rails.mdx", reason: "a comparison of each difference" },
];

const referenceTable = "a reference table, not a task";

/** Headings that must differ on a task page, such as a reference table's, and why. */
const optOuts: { page: string; heading: string; reason: string }[] = [
  { page: "(basics)/callbacks.mdx", heading: "Callback order", reason: referenceTable },
  { page: "(basics)/validations.mdx", heading: "Available validators", reason: referenceTable },
  { page: "(basics)/errors.mdx", heading: "Lifecycle errors", reason: referenceTable },
  { page: "(basics)/errors.mdx", heading: "Usage errors", reason: referenceTable },
  { page: "(basics)/errors.mdx", heading: "Constraint errors", reason: referenceTable },
];

const checkedPages = guidePages().filter(
  (page) => page.name.endsWith(".mdx") && !exemptPages.some((exempt) => exempt.page === page.name),
);

/** A page's `##` headings, leaving out lines inside code fences, indented ones included. */
function headings(text: string): string[] {
  let fenced = false;
  return text.split("\n").flatMap((line) => {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    const heading = /^## (.+)$/.exec(line)?.[1];
    return fenced || heading === undefined ? [] : [heading.trim()];
  });
}

/** How a failure names a heading: its page, then the heading as written. */
function label(page: string, heading: string): string {
  return `${page}: "## ${heading}"`;
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
        .map((heading) => label(page.name, heading)),
    );

    expect(
      offending,
      "Head the section with a gerund, or add it to optOuts in tests/unit/docs-headings.test.ts",
    ).toEqual([]);
  });
});

describe("the gerund check's opt-outs", () => {
  test("exempt only pages the guide has", () => {
    const names = new Set(guidePages().map((page) => page.name));
    const missing = exemptPages.filter(({ page }) => !names.has(page)).map(({ page }) => page);

    expect(missing).toEqual([]);
  });

  test("name headings their page has", () => {
    const stale = optOuts
      .filter(({ page, heading }) => {
        const found = checkedPages.find((checked) => checked.name === page);
        return found === undefined || !headings(found.text).includes(heading);
      })
      .map(({ page, heading }) => label(page, heading));

    expect(stale).toEqual([]);
  });
});
