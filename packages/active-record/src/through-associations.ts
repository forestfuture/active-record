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
  if (via !== undefined) checkSource(label, { model, name, definition }, via);
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
  const source = associationsOf(via).get(sourceName)!.target();
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
    const via: unknown = associationsOf(owner).get(definition.through)?.target();
    if (!isModelClass(via)) return;
    const source = sourceNameOf(association, definition, via);
    if (source !== undefined) walk(via, source);
  };
  walk(model, name);
}

/** Why nothing is written through a through association (#59): the association it goes through. */
export function readonlyError({ label, hops }: ResolvedAssociation): ReadonlyAssociation {
  return new ReadonlyAssociation(
    `Can't write through ${label}: it goes through ${hops!.via.label}`,
  );
}
