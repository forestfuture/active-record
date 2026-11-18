// A through association (#59): its declaration checked, the source association it reaches its records by, and the writes it refuses.
import { associationsOf } from "./association-fields.ts";
import type { AssociationDefinition } from "./associations.ts";
import { InvalidModel, ReadonlyAssociation } from "./errors.ts";
import { singularize } from "./inflections.ts";
import { isModelClass, type ModelClass } from "./model.ts";
import { isOnDifferentDatabases, type ResolvedAssociation } from "./resolved-association.ts";

/**
 * The name of a through association's source: the association of `via`, the Model it goes
 * through, that reaches its records. The `source` option names it; left out, it's the one
 * named as this association, singular, then as it is (`projects` → `project`, `projects`).
 * Undefined when `via` has none of those.
 */
export function sourceNameOf(
  name: string,
  { source }: AssociationDefinition,
  via: ModelClass,
): string | undefined {
  const candidates = source === undefined ? sourceCandidates(name) : [source];
  return candidates.find((candidate) => associationsOf(via).has(candidate));
}

/** The names a source is looked for by, when the `source` option leaves it out. */
function sourceCandidates(name: string): string[] {
  return [...new Set([singularize(name), name])];
}

/**
 * Checks a through association's declaration: the options it doesn't take, the association it
 * goes through, its source, which must point at its target, and that each hop is on one
 * database. Each association it reaches is checked as its own Model's, so a target that isn't
 * a Model is left for that check.
 */
export function checkThrough(
  label: string,
  model: ModelClass,
  name: string,
  definition: AssociationDefinition,
): void {
  if (definition.through === undefined) return;
  checkOptions(label, definition);
  checkNotCircular(label, model, name);
  const via = viaOf(label, model, definition);
  if (via === undefined) return;
  const declared = { model, name, definition };
  checkSource(label, declared, via);
  checkDependentShape(label, declared, via);
}

/**
 * A through hasMany's `dependent` acts on its join records, so it needs a join Model, as a
 * write through it does (#434): on any other shape, destroying the owner would remove the
 * records of the association it goes through, or of its source.
 */
function checkDependentShape(
  label: string,
  { model, name, definition }: Declared,
  via: ModelClass,
) {
  if (definition.dependent === undefined) return;
  // Checked by checkSource first, so the source is there.
  const sourceName = sourceNameOf(name, definition, via)!;
  const hops = {
    via: {
      label: `${model.name}.${definition.through!}`,
      definition: associationsOf(model).get(definition.through!)!,
    },
    source: {
      label: `${via.name}.${sourceName}`,
      definition: associationsOf(via).get(sourceName)!,
    },
  };
  const reason = shapeRefusal(definition.kind, hops);
  if (reason !== undefined)
    throw new InvalidModel(`${label}: its dependent needs a join Model: ${reason}`);
}

/** One of a Model's associations, as it's declared. */
interface Declared {
  model: ModelClass;
  name: string;
  definition: AssociationDefinition;
}

/** Its source must be one of `via`'s associations, point at its target, and be on one database. */
function checkSource(label: string, { model, name, definition }: Declared, via: ModelClass): void {
  const sourceName = sourceNameOf(name, definition, via);
  if (sourceName === undefined)
    throw new InvalidModel(`${label}: ${missingSource(name, definition, via)}`);
  const declared = associationsOf(via).get(sourceName)!;
  if (declared.targets !== undefined) {
    throw new InvalidModel(
      `${label}: its source ${via.name}.${sourceName} is a polymorphic belongsTo, which it can't reach its records by`,
    );
  }
  const source = declared.target();
  const target = definition.target();
  if (source !== target) {
    throw new InvalidModel(
      `${label}: its source ${via.name}.${sourceName} points at ${source.name}, not ${target.name}`,
    );
  }
  if (isOnDifferentDatabases(model, via) || isOnDifferentDatabases(via, target)) {
    throw new InvalidModel(
      `${label} reaches across databases, which a through association can't yet: ${model.name}, ${via.name} and ${target.name} must be on one`,
    );
  }
}

/**
 * Only a hasMany or hasOne goes through another, and not with the options its hops have
 * instead: `autosave`, and a declared key.
 */
function checkOptions(label: string, definition: AssociationDefinition): void {
  if (definition.kind === "belongsTo") {
    throw new InvalidModel(`${label}: a belongsTo can't go through another association`);
  }
  checkDependent(label, definition);
  const declaredKey = definition.inferredFrom === undefined || definition.primaryKey !== undefined;
  const refused = [
    [definition.autosave !== undefined, "autosave"],
    [declaredKey, "foreignKey or primaryKey"],
    [definition.inverseOf !== undefined, "inverseOf"],
  ] as const;
  for (const [given, option] of refused) {
    if (given) throw new InvalidModel(`${label}: a through association takes no ${option}`);
  }
}

/**
 * A through hasMany's `dependent` acts on its join records (#434), so it's one that removes
 * them, `"destroy"` or `"deleteAll"`; a hasOne through another takes none.
 */
function checkDependent(label: string, { kind, dependent }: AssociationDefinition): void {
  if (dependent === undefined) return;
  if (kind === "hasOne")
    throw new InvalidModel(`${label}: a hasOne through another takes no dependent`);
  if (dependent === "destroy" || dependent === "deleteAll") return;
  throw new InvalidModel(
    `${label}: a through association's dependent is "destroy" or "deleteAll", not "${dependent}"`,
  );
}

/**
 * The Model of the association `through` names, which must be one of `model`'s, and for a
 * hasOne, not a hasMany; undefined when its target isn't a Model, which that association's own
 * check reports.
 */
function viaOf(
  label: string,
  model: ModelClass,
  { through, kind }: AssociationDefinition,
): ModelClass | undefined {
  const via = associationsOf(model).get(through!);
  if (via === undefined) {
    throw new InvalidModel(`${label}: through "${through}" isn't an association of ${model.name}`);
  }
  if (kind === "hasOne" && via.kind === "hasMany") {
    throw new InvalidModel(`${label}: a hasOne can't go through a hasMany (${through})`);
  }
  // Its Model isn't known until a record's type is read (#60), as Rails refuses too.
  if (via.targets !== undefined) {
    throw new InvalidModel(
      `${label}: through "${through}" is a polymorphic belongsTo, which it can't go through`,
    );
  }
  const target: unknown = via.target();
  return isModelClass(target) ? target : undefined;
}

/** Why no source was found: the one named isn't there, or none of the names looked for is. */
function missingSource(name: string, definition: AssociationDefinition, via: ModelClass): string {
  if (definition.source !== undefined) {
    return `${via.name} has no association "${definition.source}" (check source)`;
  }
  const looked = sourceCandidates(name).map((candidate) => `"${candidate}"`);
  return `${via.name} has no association ${looked.join(" or ")}; pass source`;
}

/**
 * Throws when following `name`'s hops, through and source, at every level, comes back to an
 * association already passed: reading it would never end. Hops that aren't there end the walk;
 * their own checks report them.
 */
function checkNotCircular(label: string, model: ModelClass, name: string): void {
  const passed = new Map<ModelClass, Set<string>>();
  const walk = (owner: ModelClass, association: string): void => {
    const definition = associationsOf(owner).get(association);
    if (definition?.through === undefined) return;
    const names = passed.get(owner) ?? new Set<string>();
    if (names.has(association)) throw new InvalidModel(`${label} goes through itself`);
    passed.set(owner, names.add(association));
    walk(owner, definition.through);
    const through = associationsOf(owner).get(definition.through);
    // A polymorphic belongsTo has no one Model to walk on to; it's refused below (#60).
    if (through?.targets !== undefined) return;
    const via: unknown = through?.target();
    if (!isModelClass(via)) return;
    const source = sourceNameOf(association, definition, via);
    if (source !== undefined) walk(via, source);
  };
  walk(model, name);
}

/**
 * Throws `ReadonlyAssociation` when nothing is written through `association` (#434): only a
 * join Model's is written through, as in Rails, so it must go through a hasMany (a hasOne, for
 * a hasOne) to a source that's a belongsTo, and neither may go through another. Rails also
 * writes through the others, by building or updating the record of the association it goes
 * through, which replaces a shared or single record; this refuses that.
 */
export function requireWritableThrough(association: ResolvedAssociation): void {
  const reason = writeRefusal(association);
  if (reason !== undefined) {
    throw new ReadonlyAssociation(`Can't write through ${association.label}: ${reason}`);
  }
}

/** Why nothing is written through `association`, if nothing is. */
function writeRefusal({ definition, hops }: ResolvedAssociation): string | undefined {
  return shapeRefusal(definition.kind, hops!);
}

/** One hop of a through association, as its shape is checked: its name, and its declaration. */
interface Hop {
  label: string;
  definition: AssociationDefinition;
}

/**
 * Why a through association of `kind` doesn't go through a join Model, if it doesn't: it must
 * go through a hasMany (a hasOne, for a hasOne) to a belongsTo source, neither nested.
 */
function shapeRefusal(
  kind: AssociationDefinition["kind"],
  { via, source }: { via: Hop; source: Hop },
): string | undefined {
  if (via.definition.through !== undefined) {
    return `it goes through ${via.label}, which goes through another`;
  }
  if (source.definition.through !== undefined) {
    return `its source ${source.label} goes through another`;
  }
  const viaKind = via.definition.kind;
  if (viaKind !== kind) return `it goes through ${via.label}, a ${viaKind}`;
  const sourceKind = source.definition.kind;
  if (sourceKind !== "belongsTo") {
    return `its source ${source.label} is a ${sourceKind}, not a belongsTo`;
  }
  return undefined;
}

/** Why nothing is inserted through a through association, as in Rails: no join records would be. */
export function insertError({ label }: ResolvedAssociation): ReadonlyAssociation {
  return new ReadonlyAssociation(
    `Can't insert or upsert through ${label}: a bulk write makes no join records`,
  );
}
