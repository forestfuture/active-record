import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, onTestFinished, test, vi } from "vite-plus/test";
import { main } from "../../packages/active-record/cli/main.ts";
import { scratchDirs } from "../support/scratch.ts";

// In the repo, so the Models the generators write find this repo's library, as an app's do.
const scratch = scratchDirs();

describe("the d1-record command line", () => {
  test("schema runs with its options, and --help explains them", async () => {
    const cwd = scratch("main-");
    mkdirSync(join(cwd, "migrations"));
    writeFileSync(join(cwd, "wrangler.jsonc"), '{ "d1_databases": [{ "binding": "DB" }] }');
    writeFileSync(join(cwd, "migrations/0001.sql"), "CREATE TABLE users (id INTEGER PRIMARY KEY);");
    const output: string[] = [];
    // Paths are relative to where the command runs, so run it in the project, not the repo.
    const inProject = vi.spyOn(process, "cwd").mockReturnValue(cwd);
    onTestFinished(() => inProject.mockRestore());

    const help = main(["--help"], (line) => output.push(line));
    const generated = await main(
      ["schema", "--config", join(cwd, "wrangler.jsonc"), "--out", join(cwd, "out.ts")],
      (line) => output.push(line),
    );

    expect(help).toBe(0);
    expect(output[0]).toMatch(/^Usage:\n  active-record schema \[options\]/);
    expect(generated).toBe(0);
    expect(output[1]).toMatch(/^Wrote .*out\.ts \(1 table\)/);
  });

  test("anything else prints the usage and fails", () => {
    const output: string[] = [];

    expect(main(["deploy"], (line) => output.push(line))).toBe(1);
    expect(output[0]).toMatch(/^Usage:/);
  });

  test("an unknown option says so, with the usage", () => {
    const output: string[] = [];

    expect(main(["schema", "--chek"], (line) => output.push(line))).toBe(1);
    expect(output[0]).toMatch(/^Unknown option '--chek'.*\n\nUsage:/s);
  });

  test("a Node before 22.13 is told which Node it needs", () => {
    const output: string[] = [];
    const versions = process.versions;
    Object.defineProperty(process, "versions", { value: { ...versions, node: "22.12.0" } });

    try {
      expect(main(["schema"], (line) => output.push(line))).toBe(1);
    } finally {
      Object.defineProperty(process, "versions", { value: versions });
    }
    expect(output).toEqual([
      "active-record schema needs Node 22.13 or later (this is Node 22.12.0)",
    ]);
  });

  test("g model and g migration run the generators, with their own options", async () => {
    const cwd = scratch("main-");
    writeFileSync(join(cwd, "wrangler.jsonc"), '{ "d1_databases": [{ "binding": "DB" }] }');
    const output: string[] = [];
    const print = (line: string) => output.push(line);
    const config = ["--config", join(cwd, "wrangler.jsonc")];
    // Paths are relative to where the command runs, so run it in the project.
    const inProject = vi.spyOn(process, "cwd").mockReturnValue(cwd);
    onTestFinished(() => inProject.mockRestore());

    expect(
      await main(
        ["g", "model", "Product", "name:string!", "--id", "integer", "--no-timestamps", ...config],
        print,
      ),
    ).toBe(0);
    expect(await main(["generate", "migration", "AddSkuToProducts", "sku", ...config], print)).toBe(
      0,
    );
    expect(await main(["schema", "--models", "src/app/models", ...config], print)).toBe(0);
    expect(await main(["g", "model", "Tag", "--id", "uuid", ...config], print)).toBe(1);
    expect(await main(["g", "widget", "Tag", ...config], print)).toBe(1);

    expect(output).toContain("Wrote src/app/models/application-record.ts");
    expect(output.filter((line) => line.startsWith("Wrote migrations"))).toEqual([
      "Wrote migrations/0001_create_products.sql",
      "Wrote migrations/0002_add_sku_to_products.sql",
    ]);
    expect(output.at(-1)).toMatch(
      /^Name what to generate: g model <Name> or g migration <Name>\n\nUsage:/,
    );
    expect(output).toContainEqual(expect.stringMatching(/^--id is integer or text, not uuid/));
  });
});
