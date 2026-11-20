// A belongsTo requires its record (#339): "must exist" unless it's declared `optional: true`.
import { associationsOf } from "./association-fields.ts";
import type { AssociationDefinition } from "./associations.ts";
import { modelOf, type Model } from "./model.ts";
import { state } from "./record-state.ts";
import { belongsToKeys } from "./resolved-association.ts";

/**
 * Adds "must exist" (type `required`) to each of the record's required belongsTo associations
 * whose record isn't there. One is checked only when its key is null or has an unsaved change,
 * so a saved record whose key hasn't changed costs no query. The record is read through its accessor, so it's loaded and kept. A
 * record marked for destruction counts as missing.
 */
export async function validateRequiredAssociations(record: Model): Promise<void> {
  for (const [name, definition] of associationsOf(modelOf(record))) {
    if (!isCheckDue(record, definition)) continue;
    const read = (record as unknown as Record<string, () => Promise<Model | null>>)[name]!;
    const found = await read.call(record);
    // One marked for destruction counts as missing (#37).
    if (found === null || found[state].isMarkedForDestruction) {
      record[state].errors.add(name, { type: "required" });
    }
  }
}

/**
 * Whether it's a required belongsTo whose key is loaded, and null or changed; for a polymorphic
 * one (#60), its type too.
 */
function isCheckDue(record: Model, definition: AssociationDefinition): boolean {
  if (definition.kind !== "belongsTo" || definition.optional === true) return false;
  // From the declaration: resolving it would ready its targets on every validation.
  const keys = belongsToKeys(definition);
  const recordState = record[state];
  if (!keys.every((each) => Object.hasOwn(recordState.attributes(), each))) return false;
  return keys.some(
    (each) => recordState.read(each) === null || recordState.isAttributeChanged(each),
  );
}
