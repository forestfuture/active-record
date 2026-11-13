import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, onTestFinished, test, vi } from "vite-plus/test";
import { forgetProjectFiles, projectJiti } from "../../packages/active-record/cli/project/load.ts";
import { scratchDirs } from "../support/scratch.ts";

const scratch = scratchDirs();

/** A project with a `node_modules` folder and one TypeScript file, `note.ts`. */
function project(source: string): string {
  const dir = scratch("compile-cache-");
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "note.ts"), source);
  return dir;
}

describe("the command's compiled TypeScript", () => {
  test("is cached in the project's node_modules/.cache/jiti", async () => {
    const dir = project('export const note: string = "cached";');

    await projectJiti(dir).import(join(dir, "note.ts"));

    const cache = join(dir, "node_modules/.cache/jiti");
    expect(existsSync(cache) && readdirSync(cache).length > 0).toBe(true);
  });

  test("isn't cached in the shared temporary folder when the project has no node_modules", async () => {
    const dir = scratch("compile-cache-bare-");
    writeFileSync(join(dir, "note.ts"), 'export const note: string = "uncached";');
    const temporary = scratch("compile-cache-tmp-");
    vi.stubEnv("TMPDIR", temporary);
    onTestFinished(() => void vi.unstubAllEnvs());

    await projectJiti(dir).import(join(dir, "note.ts"));

    expect(existsSync(join(temporary, "jiti"))).toBe(false);
  });

  test("an edited file is compiled again, once it's forgotten", async () => {
    const dir = project('export const note: string = "before";');
    const jiti = projectJiti(dir);
    await jiti.import(join(dir, "note.ts"));
    writeFileSync(join(dir, "note.ts"), 'export const note: string = "after";');
    forgetProjectFiles(dir, jiti, new Set());

    const edited = await jiti.import<{ note: string }>(join(dir, "note.ts"));

    expect(edited.note).toBe("after");
  });
});
