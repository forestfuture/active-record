// A command's plan (the files to write and the lines to print), and `apply`, which carries it out.
// What a command decides to do is kept apart from doing it. Commands plan from a snapshot of the
// project (cli/project/snapshot.ts), and `apply` is the one place that writes (#95).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { shown } from "./project/paths.ts";

/** Where a command prints its lines (the console, or a test's list). */
export type Print = (line: string) => void;

/** A file a command writes: where, and what. */
export interface FileToWrite {
  path: string;
  source: string;
}

/** A line to print, once its file (if it has one) is written. */
export interface Step {
  line: string;
  file?: FileToWrite;
}

/** Everything a command does, in order, and its exit code. */
export interface Plan {
  steps: Step[];
  code: number;
}

/** A line printed with no file. */
export function printed(line: string): Step {
  return { line };
}

/** A file written, then its line printed. */
export function written(file: FileToWrite, line: string): Step {
  return { file, line };
}

/** A plan that only prints these lines, with this exit code. */
export function printing(lines: readonly string[], code = 0): Plan {
  return { steps: lines.map(printed), code };
}

/** The files a plan writes, in order. */
export function filesOf(plan: Plan): FileToWrite[] {
  return plan.steps.flatMap((step) => (step.file === undefined ? [] : [step.file]));
}

/** The lines a plan prints, in order. */
export function linesOf(plan: Plan): string[] {
  return plan.steps.map((step) => step.line);
}

/** Several plans as one: every step, in order, and the worst exit code. */
export function combined(plans: readonly Plan[]): Plan {
  return {
    steps: plans.flatMap((plan) => plan.steps),
    code: Math.max(0, ...plans.map((plan) => plan.code)),
  };
}

/** A file the plan writes more than once, where a later write would replace an earlier one. */
function repeated(plan: Plan): string | undefined {
  const paths = filesOf(plan).map((file) => file.path);
  return paths.find((path, index) => paths.indexOf(path) !== index);
}

/**
 * Carries out a plan: each step writes its file (making its folder), then prints its line, so
 * a write that fails leaves the files already written said. A plan that would write one file
 * twice writes nothing. Returns the exit code.
 */
export function apply(plan: Plan, cwd: string, print: (line: string) => void): number {
  const twice = repeated(plan);
  if (twice !== undefined) {
    print(`${shown(cwd, twice)} would be written twice; choose another --out or name`);
    print("Wrote nothing");
    return 1;
  }
  for (const { file, line } of plan.steps) {
    if (file !== undefined) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.source);
    }
    print(line);
  }
  return plan.code;
}
