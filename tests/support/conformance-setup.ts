// Before each conformance test: skips it on an adapter whose allowed differences name it (ADR-0017).
import { beforeEach, inject } from "vite-plus/test";
import { differenceSkipping, fullName } from "../conformance/allowed-differences.ts";
import type { AdapterName } from "./harness.ts";

beforeEach((context) => {
  const adapter = (inject as (key: string) => unknown)("adapter") as AdapterName;
  const difference = differenceSkipping(adapter, fullName(context.task));
  if (difference !== undefined) context.skip(`allowed difference: ${difference.id}`);
});
