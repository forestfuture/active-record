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

/** The context names a rule's `on` or `exceptOn` gives. */
function listOf(contexts: ValidationContexts): readonly string[] {
  return typeof contexts === "string" ? [contexts] : contexts;
}

/** Whether one of `contexts` is listed in `listed`. */
function isListedIn(contexts: readonly string[], listed: ValidationContexts): boolean {
  return listOf(listed).some((context) => contexts.includes(context));
}

/**
 * Whether a rule runs in `contexts`: one in its `on` (every context without one), and none in its
 * `exceptOn`.
 */
export function isInContext(
  contexts: readonly string[],
  { on, exceptOn }: { on?: ValidationContexts; exceptOn?: ValidationContexts },
): boolean {
  if (on !== undefined && !isListedIn(contexts, on)) return false;
  return exceptOn === undefined || !isListedIn(contexts, exceptOn);
}
