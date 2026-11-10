// Each published tarball holds exactly its files: the core with its entries, the `active-record`
// command, the D1 and PostgreSQL adapters, its docs for agents, its config's JSON Schema and its
// manifest. Run with `vp run check:package`, after
// `vp run build` and `vp run docs:build` (as CI does): it packs what's built, skipping `prepack`.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

/** Each package's files, a shared chunk's name standing for every chunk Rolldown names by hash. */
const expected = {
  "active-record": [
    "LICENSE",
    "README.md",
    "config-schema.json",
    "dist/<chunk>.d.mts",
    "dist/<chunk>.mjs",
    "dist/adapter.d.mts",
    "dist/adapter.mjs",
    "dist/cli.d.mts",
    "dist/cli.mjs",
    "dist/command.d.mts",
    "dist/command.mjs",
    "dist/d1.d.mts",
    "dist/d1.mjs",
    "dist/index.d.mts",
    "dist/index.mjs",
    "dist/postgresql.d.mts",
    "dist/postgresql.mjs",
    "llms-full.txt",
    "package.json",
    "skills/active-record/SKILL.md",
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

// The adapters' drivers are the app's: optional peer dependencies, imported by name, never bundled
// (#301). A Worker on D1 bundles none of them, since only the PostgreSQL entry imports pg.
const dist = new URL("../packages/active-record/dist/", import.meta.url);
const built = Object.fromEntries(
  readdirSync(dist)
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => [file, readFileSync(new URL(file, dist), "utf8")]),
);
for (const [file, text] of Object.entries(built)) {
  if (/class PGlite\b|class Client extends/.test(text)) fail(`${file} bundles PGlite or pg`);
}
/** The packages a file imports by name, with those of every chunk it imports, and theirs. */
function packagesOf(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const statements =
    /^(?:import|export)\b[^;"]*?(?:\bfrom\s*)?"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)/gm;
  const names = [...built[file].matchAll(statements)].map(([, from, loaded]) => from ?? loaded);
  const chunks = names.filter((name) => name.startsWith("./")).map((name) => name.slice(2));
  const packages = names.filter((name) => !name.startsWith("."));
  return new Set([...packages, ...chunks.flatMap((chunk) => [...packagesOf(chunk, seen)])]);
}
const outside = (file) => [...packagesOf(file)].filter((name) => name !== "cloudflare:workers");
if (outside("d1.mjs").length > 0) fail(`dist/d1.mjs reaches ${outside("d1.mjs").join(", ")}`);
if (outside("postgresql.mjs").join() !== "pg") {
  fail(`dist/postgresql.mjs reaches ${outside("postgresql.mjs").join(", ")}, not pg alone`);
}
const manifest = JSON.parse(
  readFileSync(new URL("../packages/active-record/package.json", import.meta.url), "utf8"),
);
for (const driver of ["pg", "@electric-sql/pglite"]) {
  if (
    manifest.peerDependenciesMeta?.[driver]?.optional !== true ||
    driver in (manifest.dependencies ?? {})
  )
    fail(`${driver} isn't an optional peer dependency`);
}
console.log(
  "The adapters bundle no driver: pg and PGlite are optional peers, and only the PostgreSQL entry imports pg",
);

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
const sources = guide.match(/^Source: https:\/\/active-record\.forestfuture\.dev\//gm)?.length ?? 0;
if (sources !== pages)
  fail(`llms-full.txt names the source URL of ${sources} pages, of the guide's ${pages}`);
console.log(
  `llms-full.txt names each of its ${pages} pages' source URL, and links no page relatively`,
);
