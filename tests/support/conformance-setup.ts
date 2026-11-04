// Before each conformance test: skips it on an adapter whose allowed differences name it (ADR-0017).
import { beforeEach } from "vite-plus/test";
import { differenceSkipping, fullName } from "../conformance/allowed-differences.ts";
import { providedAdapter } from "./harness.ts";

beforeEach((context) => {
  const difference = differenceSkipping(providedAdapter(), fullName(context.task));
  if (difference !== undefined) context.skip(`allowed difference: ${difference.id}`);
});
