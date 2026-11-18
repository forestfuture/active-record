// An association's inverse (#62): the target's association that points back at its owner, inferred or named by `inverseOf`, and checking `inverseOf` at first use.
import { associationsOf } from "./association-fields.ts";
import type { AssociationDefinition } from "./associations.ts";
import { InvalidModel } from "./errors.ts";
import type { Model, ModelClass } from "./model.ts";
import { linkOf, resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/** One declared association: its Model, its name and its definition. */
interface Declared {
  model: ModelClass;
  name: string;
  definition: AssociationDefinition;
}

/**
 * The belongsTo on a hasMany's or hasOne's records that points back at `owner`: the one
 * `inverseOf` names, or else the first of the target's belongsTo associations through the same
 * foreign key, and type (#60), to the owner's Model, through the same key. A polymorphic one is
 * its branch for the owner's Model. None is inferred when either side has a scope, which could
 * leave the owner out, or the belongsTo says `inverseOf: false`; none with `inverseOf: false`,
 * or through another association, whose records hold no key of the owner's.
 */
export function inverseOf(
  owner: Model,
  association: ResolvedAssociation,
): ResolvedAssociation | undefined {
  const { target, definition } = association;
  if (definition.inverseOf === false || association.hops !== undefined) return undefined;
  if (definition.inverseOf !== undefined) {
    return resolveAssociation(target, definition.inverseOf).branchForRecord(owner);
  }
  if (definition.scope !== undefined) return undefined;
  for (const [name, candidate] of associationsOf(target)) {
    if (!isInferable(candidate, definition)) continue;
    const branch = resolveAssociation(target, name).branchForRecord(owner);
    if (branch?.targetAttribute === association.ownerAttribute) return branch;
  }
  return undefined;
}

/** Whether `candidate` may be inferred as the inverse of a hasMany or hasOne, `definition`. */
function isInferable(candidate: AssociationDefinition, definition: AssociationDefinition): boolean {
  return (
    candidate.kind === "belongsTo" &&
    candidate.scope === undefined &&
    candidate.inverseOf !== false &&
    candidate.foreignKey === definition.foreignKey &&
    candidate.foreignType === definition.foreignType
  );
}

/**
 * The hasOne on a belongsTo's record, `record`, that points back at the belongsTo's owner: the
 * one `inverseOf` names, or else the one whose own inverse is the belongsTo. A hasMany is never
 * one: the owner isn't the whole collection, as in Rails.
 */
export function inverseHasOne(
  record: Model,
  belongsTo: ResolvedAssociation,
): ResolvedAssociation | undefined {
  const { target, definition } = belongsTo;
  if (definition.inverseOf === false) return undefined;
  if (definition.inverseOf !== undefined) return resolveAssociation(target, definition.inverseOf);
  for (const [name, candidate] of associationsOf(target)) {
    if (candidate.kind !== "hasOne") continue;
    const hasOne = resolveAssociation(target, name);
    if (isSameAssociation(inverseOf(record, hasOne), belongsTo)) return hasOne;
  }
  return undefined;
}

/** Whether two resolved associations are one: the same name on the same Model. */
function isSameAssociation(one: ResolvedAssociation | undefined, other: ResolvedAssociation) {
  return one?.owner === other.owner && one.name === other.name;
}

/**
 * The association `inverseOf` names must be on each of `targets` (#62): a belongsTo for a hasMany
 * or hasOne, a hasOne for a belongsTo, linking the same keys back to the declaring Model.
 * Checked from the declarations, so no other Model is made ready while this one is.
 */
export function checkInverseOf(
  label: string,
  declared: Declared,
  targets: readonly ModelClass[],
): void {
  const { inverseOf: name, through } = declared.definition;
  if (typeof name !== "string" || through !== undefined) return;
  for (const target of targets) {
    const definition = associationsOf(target).get(name);
    if (definition === undefined) {
      throw new InvalidModel(
        `${label}: inverseOf names "${name}", which isn't an association of ${target.name}`,
      );
    }
    checkNamed(label, declared, { model: target, name, definition });
  }
}

/** The named association is of the kind that points back, and links the same keys. */
function checkNamed(label: string, declared: Declared, named: Declared): void {
  const wanted = declared.definition.kind === "belongsTo" ? "hasOne" : "belongsTo";
  const { kind } = named.definition;
  if (kind !== wanted) {
    const collection =
      kind === "hasMany" ? ", and a belongsTo's record doesn't fill a collection" : "";
    throw new InvalidModel(
      `${label}: inverseOf must name a ${wanted} of ${named.model.name}; "${named.name}" is a ${kind}${wanted === "hasOne" ? collection : ""}`,
    );
  }
  const [belongsTo, other] = wanted === "hasOne" ? [declared, named] : [named, declared];
  if (!isInversePair(belongsTo, other)) {
    throw new InvalidModel(
      `${label}: inverseOf "${named.name}" doesn't link ${named.model.name} back to ${declared.model.name} through the same keys`,
    );
  }
}

/**
 * Whether a belongsTo and a hasMany or hasOne are two sides of one link: each points at the
 * other's Model, through the same foreign key, type (#60) and key, and not through another.
 */
function isInversePair(belongsTo: Declared, other: Declared): boolean {
  const { definition: pointing } = belongsTo;
  const { definition: pointedAt } = other;
  if (pointedAt.through !== undefined || pointing.foreignKey !== pointedAt.foreignKey) return false;
  if (pointing.foreignType !== pointedAt.foreignType) return false;
  const listed = pointing.targets?.() ?? [pointing.target()];
  if (!listed.some((each) => isOrExtends(other.model, each))) return false;
  if (!isOrExtends(belongsTo.model, pointedAt.target())) return false;
  const key = linkOf(pointing, belongsTo.model, other.model).targetAttribute;
  return key === linkOf(pointedAt, other.model, belongsTo.model).ownerAttribute;
}

/** Whether `model` is `base` or one of its subclasses. */
function isOrExtends(model: ModelClass, base: ModelClass): boolean {
  return model === base || model.prototype instanceof base;
}
