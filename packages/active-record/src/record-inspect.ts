// How a record prints in a console, a log or a test failure: its class and attributes (#104).
import { isFiltered } from "./filtering.ts";
import {
  FilteredMark,
  inspectCustom,
  printed,
  type Inspect,
  type InspectArgs,
} from "./inspect-support.ts";
import type { ModelClass } from "./model.ts";
import type { Changes, RecordState } from "./record-state.ts";

/** An unsaved change: the new value, and the one the record was loaded or saved with, if any. */
class Unsaved {
  readonly #value: unknown;
  readonly #previous: unknown;

  constructor(value: unknown, previous: unknown) {
    this.#value = value;
    this.#previous = previous;
  }

  [inspectCustom](_depth: number, options: object, inspect: Inspect): string {
    const now = inspect(this.#value, options);
    return this.#previous === undefined
      ? `${now} (changed)`
      : `${now} (was ${inspect(this.#previous, options)})`;
  }
}

/** One attribute as it prints: filtered values marked, unsaved changes flagged. */
function printedValue(model: ModelClass, name: string, value: unknown, changes: Changes): unknown {
  const change = changes[name];
  // A null has nothing to hide, but becoming null is a change worth flagging.
  if (isFiltered(model, name) && (value !== null || change)) return new FilteredMark(!!change);
  return change ? new Unsaved(value, change[0]) : value;
}

/** `Name { attribute: value, … }`, its values printed by the runtime's own `inspect`. */
export function inspectRecord(model: ModelClass, record: RecordState, args: InspectArgs): string {
  // A new record's attributes are all unsaved, so only a persisted record flags its changes.
  const changes = record.isPersisted ? record.changesSinceLoad() : {};
  const body = () =>
    Object.fromEntries(
      Object.entries(record.attributes()).map(([name, value]) => [
        name,
        printedValue(model, name, value, changes),
      ]),
    );
  return printed(model.name, model.name, body, args);
}
