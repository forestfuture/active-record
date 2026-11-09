import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

const site = new URL("../../site/", import.meta.url);

/** Each `from to status` line of the site's _redirects, which Workers static assets serve. */
const redirects = readFileSync(new URL("public/_redirects", site), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "" && !line.startsWith("#"))
  .map((line) => line.trim().split(/\s+/));

/** Every page's path on the site: its file's name, out of its sidebar group's folder. */
const pages = readdirSync(new URL("docs/", site), { recursive: true, encoding: "utf8" })
  .filter((file) => /\.mdx?$/.test(file) && !file.startsWith("_"))
  .map((file) => `/${file.replace(/^\([^)]+\)\//, "").replace(/\.mdx?$/, "")}`);

// A page that moved keeps its old links working: the PostgreSQL page was /postgres (#301).
describe("the guide's moved pages", () => {
  test("/postgres moves permanently to /postgresql", () => {
    expect(redirects).toContainEqual(["/postgres", "/postgresql", "301"]);
  });

  test.each(redirects)("%s goes to a page, from a path no page has", (from, to, status) => {
    expect(pages).toContain(to);
    expect(pages).not.toContain(from);
    expect(status).toBe("301");
  });
});
