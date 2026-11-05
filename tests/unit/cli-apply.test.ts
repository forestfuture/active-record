import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { apply, printed, written } from "../../packages/active-record/cli/plan.ts";

/** A throwaway project folder. */
function folder(): string {
  return mkdtempSync(join(tmpdir(), "d1-record-apply-"));
}

describe("apply: writing a command's plan", () => {
  test("writes each file, printing its line once it's written, then the rest in order", () => {
    const cwd = folder();
    const lines: string[] = [];
    const code = apply(
      {
        steps: [
          printed("first"),
          written({ path: join(cwd, "src/a.ts"), source: "a" }, "Wrote src/a.ts"),
          printed("last"),
        ],
        code: 0,
      },
      cwd,
      (line) => lines.push(line),
    );

    expect(code).toBe(0);
    expect(lines).toEqual(["first", "Wrote src/a.ts", "last"]);
    expect(readFileSync(join(cwd, "src/a.ts"), "utf8")).toBe("a");
  });

  test("refuses a plan that writes one file twice, writing nothing", () => {
    const cwd = folder();
    const lines: string[] = [];
    const path = join(cwd, "src/models/product.ts");
    const code = apply(
      {
        steps: [
          written({ path, source: "model" }, "Wrote src/models/product.ts"),
          written({ path, source: "schema" }, "Wrote src/models/product.ts (1 table)"),
        ],
        code: 0,
      },
      cwd,
      (line) => lines.push(line),
    );

    expect(code).toBe(1);
    expect(lines).toEqual([
      "src/models/product.ts would be written twice; choose another --out or name",
      "Wrote nothing",
    ]);
    expect(existsSync(path)).toBe(false);
  });

  test("a write that fails leaves the lines of the files already written printed", () => {
    const cwd = folder();
    writeFileSync(join(cwd, "src"), "a file where a folder should be");
    const lines: string[] = [];
    const plan = {
      steps: [
        written({ path: join(cwd, "first.ts"), source: "1" }, "Wrote first.ts"),
        written({ path: join(cwd, "src/second.ts"), source: "2" }, "Wrote src/second.ts"),
      ],
      code: 0,
    };

    expect(() => apply(plan, cwd, (line) => lines.push(line))).toThrow();
    expect(lines).toEqual(["Wrote first.ts"]);
  });
});
