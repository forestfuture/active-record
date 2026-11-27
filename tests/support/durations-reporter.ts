// Writes test-durations.json, the seconds each test file took per project, for DurationSequencer (#614); `vp run test:durations <run-id>` runs it on a CI run's merged reports.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Reporter, TestModule, Vitest } from "vite-plus/test/node";
import { byCodePoint, durationKey, durationsPath } from "./duration-sequencer.ts";

/**
 * A test file's time in its worker, to a tenth of a second: its tests and hooks, collecting them,
 * its setup files, its environment, and setting up the test harness.
 */
function secondsOf(module: TestModule): number {
  const diagnostic = module.diagnostic();
  const total =
    diagnostic.duration +
    diagnostic.collectDuration +
    diagnostic.setupDuration +
    diagnostic.environmentSetupDuration +
    diagnostic.prepareDuration;
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
      .sort(([a], [b]) => byCodePoint(a, b));
    const text = `${JSON.stringify(Object.fromEntries(durations), null, 2)}\n`;
    writeFileSync(join(this.#root, durationsPath), text);
    console.log(`Recorded ${durations.length} test files' durations in ${durationsPath}`);
  }
}
