// Writes test-durations.json, the seconds each test file took per project, for DurationSequencer (#614); `vp run test:durations <run-id>` runs it on a CI run's merged reports.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Reporter, TestModule, Vitest } from "vite-plus/test/node";
import { durationKey, durationsPath } from "./duration-sequencer.ts";

/** A test file's time in a run: its tests and hooks, collecting them, and its setup files and environment. */
function secondsOf(module: TestModule): number {
  const { duration, collectDuration, setupDuration, environmentSetupDuration } =
    module.diagnostic();
  const total = duration + collectDuration + setupDuration + environmentSetupDuration;
  return Math.round(total / 100) / 10;
}

export default class DurationsReporter implements Reporter {
  #root = "";

  onInit(ctx: Vitest): void {
    this.#root = ctx.config.root;
  }

  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    const durations = modules
      .map(
        (module) =>
          [durationKey(module.project.name, module.relativeModuleId), secondsOf(module)] as const,
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const text = `${JSON.stringify(Object.fromEntries(durations), null, 2)}\n`;
    writeFileSync(join(this.#root, durationsPath), text);
    console.log(`Recorded ${durations.length} test files' durations in ${durationsPath}`);
  }
}
