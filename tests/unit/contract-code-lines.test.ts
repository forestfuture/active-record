import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

const packages = new URL("../../packages/", import.meta.url).pathname;
const contract = readFileSync(new URL("../../docs/contract.md", import.meta.url), "utf8");

/** Modules no behavior section owns, each with the reason it's left off every _Code:_ line. */
const noBehaviorSection: Record<string, string> = {};

/** Every module of the core and the command, as the contract writes its path (`arbor/src/model.ts`). */
const modules = ["arbor/src", "arbor/cli"]
  .flatMap((folder) =>
    readdirSync(`${packages}${folder}`, { recursive: true, encoding: "utf8" }).map(
      (file) => `${folder}/${file}`,
    ),
  )
  .filter((path) => path.endsWith(".ts"));

/** The module paths the _Code:_ lines name: a file, or a folder ending in `/` that names the files under it. */
const named = contract
  .split("\n")
  .flatMap((line) => line.split("_Code:_").slice(1))
  .flatMap((code) => [...code.matchAll(/`(arbor\/[^`]+)`/g)].map(([, path]) => path!));

function isNamedBy(module: string, path: string): boolean {
  return path.endsWith("/") ? module.startsWith(path) : module === path;
}

// A section's _Code:_ line is where a change to its behavior starts looking, so a module left off it is missed (#566).
describe("the contract's Code lines", () => {
  test("name every module", () => {
    const unnamed = modules.filter(
      (module) => !(module in noBehaviorSection) && !named.some((path) => isNamedBy(module, path)),
    );

    expect(unnamed).toEqual([]);
  });

  test("name only modules that exist", () => {
    const stale = named.filter((path) => !modules.some((module) => isNamedBy(module, path)));

    expect(stale).toEqual([]);
  });

  test("leave out only modules that exist and no Code line names", () => {
    const stale = Object.keys(noBehaviorSection).filter(
      (module) => !modules.includes(module) || named.some((path) => isNamedBy(module, path)),
    );

    expect(stale).toEqual([]);
  });
});
