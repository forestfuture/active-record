import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The guide's pages as written: every Markdown or MDX file under site/docs but the generated
// excerpts, named by their path there, such as `(basics)/models.mdx`. And the READMEs, at the
// repository's root and each package's, named by their path from the root.

const root = join(import.meta.dirname, "../..");
const docs = join(root, "site/docs");

export interface GuidePage {
  name: string;
  text: string;
}

export function guidePages(): GuidePage[] {
  return readdirSync(docs, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.mdx?$/.test(name) && !name.startsWith("_"))
    .map((name) => ({ name, text: readFileSync(join(docs, name), "utf8") }));
}

export function readmes(): GuidePage[] {
  const packages = readdirSync(join(root, "packages")).map((name) => `packages/${name}/README.md`);
  return ["README.md", ...packages]
    .filter((name) => existsSync(join(root, name)))
    .map((name) => ({ name, text: readFileSync(join(root, name), "utf8") }));
}
