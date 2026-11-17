// Checking a polymorphic association's declaration (#60): the Models it lists, the attribute holding its type, what it can't take, and the other side's `as`.
import { associationsOf } from "./association-fields.ts";
import type { AssociationDefinition } from "./associations.ts";
import { InvalidModel } from "./errors.ts";
import type { ModelClass } from "./model.ts";
import { tableOwnerModelName } from "./table-names.ts";

/**
 * A polymorphic belongsTo must list at least one Model, each stored as a type of its own, and
 * declare its type attribute; it takes no scope (#436). A hasMany or hasOne with `as` is
 * checked against its target (`checkOtherSide`). Any other association passes.
 */
export function checkPolymorphic(
  label: string,
  model: ModelClass,
  definition: AssociationDefinition,
  targets: readonly ModelClass[],
): void {
  if (definition.as !== undefined) return checkOtherSide(label, model, definition, targets[0]!);
  if (definition.targets === undefined) return;
  if (targets.length === 0) throw new InvalidModel(`${label} must list the Models it can point at`);
  if (definition.scope !== undefined) {
    throw new InvalidModel(`${label}: a polymorphic belongsTo takes no scope`);
  }
  checkStoredNames(label, targets);
  checkTypeAttribute(label, model, definition);
}

/**
 * A hasMany or hasOne with `as`: its target declares the type attribute, and if it declares a
 * belongsTo of that name, it's polymorphic and lists the owner's Model or one it extends, so the
 * records read back.
 */
function checkOtherSide(
  label: string,
  model: ModelClass,
  definition: AssociationDefinition,
  target: ModelClass,
): void {
  checkTypeAttribute(label, target, definition);
  const name = definition.as!;
  const other = associationsOf(target).get(name);
  if (other === undefined || other.kind !== "belongsTo") return;
  const otherLabel = `${target.name}.${name}`;
  if (other.targets === undefined) {
    throw new InvalidModel(
      `${label}: ${otherLabel} isn't a polymorphic belongsTo; declare it belongsTo([${model.name}, …])`,
    );
  }
  // The owner itself, or a Model it extends: a class that only shares a listed one's name would
  // read and write that Model's records.
  const isListed = (each: ModelClass) =>
    each === model || Object.prototype.isPrototypeOf.call(each, model);
  if (!other.targets().some(isListed)) {
    throw new InvalidModel(
      `${label}: ${otherLabel} doesn't list ${model.name}; add it to belongsTo([…])`,
    );
  }
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

/** `model`, the side that holds the type, declares the attribute holding it. */
function checkTypeAttribute(
  label: string,
  model: ModelClass,
  { foreignType, typeInferredFrom, as }: AssociationDefinition,
): void {
  if (model.attributeDefinitions.has(foreignType!)) return;
  const source = as === undefined ? `the association name ${typeInferredFrom}` : `as: "${as}"`;
  const hint =
    typeInferredFrom === undefined
      ? "check foreignType"
      : `inferred from ${source}; declare it, or pass foreignType`;
  throw new InvalidModel(`${label}: ${model.name} has no attribute "${foreignType}" (${hint})`);
}
