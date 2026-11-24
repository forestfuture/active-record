// The lock version (#357): the integer `lockVersion` attribute whose presence turns optimistic locking on, and which a NULL in its row reads as 0.
import type { ModelClass } from "./model.ts";

/** The attribute whose presence, as an integer, turns locking on. */
export const lockVersion = "lockVersion";

/** Whether the Model's records lock: it has an integer `lockVersion`. */
export function isLocking(model: ModelClass): boolean {
  return model.attributeDefinitions.get(lockVersion)?.type === "integer";
}

/** Whether `name` is the Model's lock version, which a NULL in its row reads as 0. */
export function isLockVersion(model: ModelClass, name: string): boolean {
  return name === lockVersion && isLocking(model);
}
