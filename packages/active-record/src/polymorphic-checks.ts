// Checking a polymorphic association's declaration (#60): the Models it lists, the attribute holding its type, and what it can't take.
import type { AssociationDefinition } from "./associations.ts";
import { InvalidModel } from "./errors.ts";
import type { ModelClass } from "./model.ts";
import { tableOwnerModelName } from "./table-names.ts";

/**
 * A polymorphic belongsTo must list at least one Model, each stored as a type of its own, and
 * declare its type attribute; it takes no scope (#436). Any other association passes.
 */
export function checkPolymorphic(
  label: string,
  model: ModelClass,
  definition: AssociationDefinition,
  targets: readonly ModelClass[],
): void {
  if (definition.targets === undefined) return;
  if (targets.length === 0) throw new InvalidModel(`${label} must list the Models it can point at`);
  if (definition.scope !== undefined) {
    throw new InvalidModel(`${label}: a polymorphic belongsTo takes no scope`);
  }
  checkStoredNames(label, targets);
  checkTypeAttribute(label, model, definition);
}

/** Each listed Model is stored as its own type: a modelName, which no other listed Model has. */
function checkStoredNames(label: string, targets: readonly ModelClass[]): void {
  const listed = new Map<string, ModelClass>();
  for (const target of targets) {
    const stored = tableOwnerModelName(target);
    if (stored === "") {
      throw new InvalidModel(
        `${label} lists a Model with no modelName to store as its type; set static modelName`,
      );
    }
    const other = listed.get(stored);
    if (other !== undefined) {
      throw new InvalidModel(
        `${label} lists ${other.name} and ${target.name}, which are both stored as the type "${stored}"; list one of them`,
      );
    }
    listed.set(stored, target);
  }
}

/** The owner declares the attribute holding the type. */
function checkTypeAttribute(
  label: string,
  model: ModelClass,
  { foreignType, typeInferredFrom }: AssociationDefinition,
): void {
  if (model.attributeDefinitions.has(foreignType!)) return;
  const hint =
    typeInferredFrom === undefined
      ? "check foreignType"
      : `inferred from the association name ${typeInferredFrom}; declare it, or pass foreignType`;
  throw new InvalidModel(`${label}: ${model.name} has no attribute "${foreignType}" (${hint})`);
}
