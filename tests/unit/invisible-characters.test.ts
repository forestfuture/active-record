import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
  codePointName,
  findInvisibleCharacters,
  invisibleCharacters,
} from "../support/invisible-characters.ts";

// A raw no-break space reads as a plain one, so an example or an expected value says something
// other than what it holds; a file writes one as an escape instead (#605).
const root = new URL("../../", import.meta.url).pathname;

/** Every file git tracks that the checkout still holds. */
const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter((file) => file !== "" && existsSync(`${root}${file}`));

describe("finding invisible characters", () => {
  test("names each one's line, column and code point", () => {
    expect(findInvisibleCharacters("one\u00a0two\nthree\u2028four\u200b")).toEqual([
      "1:4 U+00A0",
      "2:6 U+2028",
      "2:11 U+200B",
    ]);
  });

  test("counts a column in characters, not code units", () => {
    expect(findInvisibleCharacters("\u{1f333}\ufeff")).toEqual(["1:2 U+FEFF"]);
  });

  test.each([
    ["the ASCII space", " "],
    ["a tab", "\t"],
    ["a typographic apostrophe", "\u2019"],
    ["an em dash", "\u2014"],
    ["an escape written as text", "\\u00a0"],
  ])("passes %s", (_what, text) => {
    expect(findInvisibleCharacters(text)).toEqual([]);
  });

  test.each([
    "\u00a0",
    "\u00ad",
    "\u1680",
    "\u180e",
    "\u2007",
    "\u200d",
    "\u2029",
    "\u202e",
    "\u202f",
    "\u2060",
    "\u2066",
    "\u3000",
    "\ufeff",
    "\u{e0001}",
  ])("finds %j", (character) => {
    expect(findInvisibleCharacters(character)).toEqual([`1:1 ${codePointName(character)}`]);
  });

  test("lists each invisible character once, in code point order", () => {
    const codePoints = invisibleCharacters.map((character) => character.codePointAt(0)!);

    expect(codePoints).toEqual([...new Set(codePoints)].sort((a, b) => a - b));
  });

  test("leaves the ASCII space off the list", () => {
    expect(invisibleCharacters).not.toContain(" ");
  });
});

describe("the repository's tracked files", () => {
  test("hold no invisible character, so each one is written as an escape", () => {
    const found = trackedFiles.flatMap((file) => {
      const text = readFileSync(`${root}${file}`, "utf8");
      if (text.includes("\0")) return [];
      return findInvisibleCharacters(text).map((place) => `${file}:${place}`);
    });

    expect(trackedFiles.length).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});
