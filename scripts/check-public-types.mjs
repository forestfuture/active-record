// Fails if a package's published type declarations expose library internals. Run after `vp run build`.
// Internals are marked `/** @internal */` and stripped (stripInternal in each src/tsconfig.json).
import { readFileSync } from "node:fs";

/** Internal names that must never appear in the published types. */
const INTERNAL = [
  "OwnedCollection",
  "ResolvedAssociation",
  "resolveAssociation",
  "linkOf",
  "prepareModel",
  "QueryDescription",
  "RelationParts",
  "ofOwner",
  "applyScope",
  "requirePreloadable",
  "statementParts",
  "recordStatementParts",
  "comparisonParts",
  "RecordState",
  "CachedAssociation",
  "Executor",
  "CompiledSql",
  "clearErrors",
];

/** Each package's published declarations: the core's, then the adapters'. */
const files = ["index", "d1", "postgresql"].map(
  (name) => new URL(`../packages/active-record/dist/${name}.d.mts`, import.meta.url),
);
const problems = [];
for (const file of files) {
  const declarations = readFileSync(file, "utf8");
  const exposed = INTERNAL.filter((name) => new RegExp(`\\b${name}\\b`).test(declarations));
  for (const name of exposed) problems.push(`${name} in ${file.pathname.split("/packages/")[1]}`);

  // Relations come from db.model() and other Relations: no public constructor.
  const relation = /declare class Relation<[\s\S]*?\n\}/.exec(declarations)?.[0] ?? "";
  if (/^\s*constructor\(/m.test(relation)) problems.push("a public Relation constructor");
}

if (problems.length > 0) {
  console.error(`The published types expose internals: ${problems.join(", ")}`);
  process.exit(1);
}
console.log("The published index.d.mts files expose no internals");
