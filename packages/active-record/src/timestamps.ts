// `createdAt` and `updatedAt`: the timestamps a write adds.
import type { Assignment } from "./compiler.ts";
import type { ModelClass } from "./model.ts";

/** Whether the Model declares `name` as a datetime attribute, which turns its timestamp on. */
function hasTimestamp(model: ModelClass, name: "createdAt" | "updatedAt"): boolean {
  return model.attributeDefinitions.get(name)?.type === "datetime";
}

/**
 * The timestamps to add to a write: `createdAt` and `updatedAt` on insert, `updatedAt` on
 * update. Never one the write already assigns.
 */
export function timestampsFor(
  model: ModelClass,
  write: "insert" | "update",
  own: readonly Assignment[],
): Assignment[] {
  const now = new Date();
  const assigned = new Set(own.map(([name]) => name));
  const names =
    write === "insert" ? (["createdAt", "updatedAt"] as const) : (["updatedAt"] as const);
  return names
    .filter((name) => hasTimestamp(model, name) && !assigned.has(name))
    .map((name): Assignment => [name, now]);
}
