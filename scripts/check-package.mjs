// Each published tarball holds exactly its files: the core with its entries, the `active-record`
// command, its docs for agents and its manifest; the D1 adapter with its build and its plugin. The adapter imports the
// core only through its entries, never a copy of it. Run with `vp run check:package`, after
// `vp run build` and `vp run docs:build` (as CI does): it packs what's built, skipping `prepack`.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

/** Each package's files, a shared chunk's name standing for every chunk Rolldown names by hash. */
const expected = {
  "active-record": [
    "LICENSE",
    "README.md",
    "dist/<chunk>.d.mts",
    "dist/<chunk>.mjs",
    "dist/adapter.d.mts",
    "dist/adapter.mjs",
    "dist/cli.d.mts",
    "dist/cli.mjs",
    "dist/command.d.mts",
    "dist/command.mjs",
    "dist/index.d.mts",
    "dist/index.mjs",
    "llms-full.txt",
    "package.json",
    "skills/active-record/SKILL.md",
  ],
  "d1-record": [
    "LICENSE",
    "README.md",
    "dist/cli.d.mts",
    "dist/cli.mjs",
    "dist/index.d.mts",
    "dist/index.mjs",
    "package.json",
  ],
};

const root = new URL("..", import.meta.url).pathname;
/** Sorts as the expected lists are written: by code point, uppercase first. */
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

execFileSync("node", [new URL("pack-docs.mjs", import.meta.url).pathname], { stdio: "inherit" });
for (const [name, files] of Object.entries(expected)) {
  const output = execFileSync(
    "pnpm",
    ["--dir", `packages/${name}`, "pack", "--dry-run", "--json", "--config.ignore-scripts=true"],
    { cwd: root, encoding: "utf8" },
  );
  const packed = JSON.parse(output).files.map((file) => file.path);
  const named = [
    ...new Set(packed.map((path) => path.replace(/^dist\/[\w-]+-[\w-]{8}\./, "dist/<chunk>."))),
  ];
  if (JSON.stringify(named.sort(byCodePoint)) !== JSON.stringify(files)) {
    fail(
      `${name}'s tarball changed.\nExpected: ${files.join(", ")}\nPacked:   ${named.join(", ")}`,
    );
  }
  console.log(`${name}'s tarball holds exactly: ${named.join(", ")}`);
}

// Each adapter's build imports the core by name, through its public entries, and bundles none of it.
const allowed = [
  "@forestfuture/active-record",
  "@forestfuture/active-record/adapter",
  "@forestfuture/active-record/cli",
];
for (const adapter of ["d1-record", "pg-record"]) {
  const built = readdirSync(new URL(`../packages/${adapter}/dist/`, import.meta.url))
    .filter((file) => file.endsWith(".mjs"))
    .map((file) =>
      readFileSync(new URL(`../packages/${adapter}/dist/${file}`, import.meta.url), "utf8"),
    )
    .join("\n");
  const entries = new Set(
    [...built.matchAll(/from "(@forestfuture\/active-record[^"]*)"/g)].map(([, entry]) => entry),
  );
  const unknown = [...entries].filter((entry) => !allowed.includes(entry));
  if (unknown.length > 0) fail(`${adapter} imports the core through ${unknown.join(", ")}`);
  if (/class Relation\b|function compileSelect\b/.test(built))
    fail(`${adapter} bundles a copy of the core`);
  // pg is the app's, a peer dependency, and PGlite is pg-record's own: both loaded by name.
  if (/class PGlite\b|class Client extends/.test(built)) fail(`${adapter} bundles PGlite or pg`);
  console.log(
    `${adapter} imports the core only through ${[...entries].sort(byCodePoint).join(", ")}`,
  );
}

// An agent reads llms-full.txt as one file, away from the site, so a link to another page can't be
// relative to its page (#133). Blume writes those links from the site's root (`/models`), and each
// page opens with its `Source:` URL, which gives the host to resolve them against.
const guide = readFileSync(
  new URL("../packages/active-record/llms-full.txt", import.meta.url),
  "utf8",
);
const relative = guide.match(/\]\(\.{1,2}\/[^)]*\)/g);
if (relative) fail(`llms-full.txt has ${relative.length} relative links, such as ${relative[0]}`);
const pages = readdirSync(new URL("../site/docs", import.meta.url), { recursive: true }).filter(
  (name) => /\.mdx?$/.test(name) && !name.startsWith("_"),
).length;
const sources = guide.match(/^Source: https:\/\/d1-record\.forestfuture\.dev\//gm)?.length ?? 0;
if (sources !== pages)
  fail(`llms-full.txt names the source URL of ${sources} pages, of the guide's ${pages}`);
console.log(
  `llms-full.txt names each of its ${pages} pages' source URL, and links no page relatively`,
);
