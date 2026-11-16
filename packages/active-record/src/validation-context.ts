// Validation contexts (#51): the context a record is validated in, and whether a rule's `on` runs in it.
import type { Model } from "./model.ts";
import { state } from "./record-state.ts";

/** A validation context: `"create"`, `"update"`, or a name the app chooses (`"signup"`). */
export type ValidationContext = "create" | "update" | (string & {});

/** One context, or several. */
export type ValidationContexts = ValidationContext | readonly ValidationContext[];

/** The contexts a record is validated in: `"create"` while it's new, `"update"` once saved. */
export function contextsOf(record: Model): readonly string[] {
  return [record[state].isNew ? "create" : "update"];
}

/** Whether a rule declared `on` these contexts runs in `contexts`; with no `on`, it always does. */
export function isInContext(
  contexts: readonly string[],
  on: ValidationContexts | undefined,
): boolean {
  if (on === undefined) return true;
  const listed: readonly string[] = typeof on === "string" ? [on] : on;
  return listed.some((context) => contexts.includes(context));
}
