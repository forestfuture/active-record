// Checks a Model's declaration the first time it's used, then seals its declarations.
// It checks the table, the primary key, the attribute names, the spec keys, hidden attributes, message names, and page sizes.
import { ancestors } from "./ancestors.ts";
import { associationsOf, declarationIn, probeOf } from "./association-fields.ts";
import { attributesNamedInMessages } from "./error-messages.ts";
import { declared, seal } from "./declarations.ts";
import { InvalidModel } from "./errors.ts";
import { Model, type ModelClass } from "./model.ts";
import { specProblem } from "./spec-keys.ts";
import { isGenerated, settleGenerated } from "./generated-model.ts";
import { checkValidatedNames } from "./validations.ts";
import { rejectAbstract, requireTableName } from "./table-names.ts";

// Module-level, but not request state (ADR-0003): it only remembers which Model
// classes have passed verifyModel(). Concurrent requests at worst verify twice.
const verified = new WeakSet<object>();

/** Checks a Model's declaration the first time it's used; throws `InvalidModel`. */
export function verifyModel(model: ModelClass): void {
  if (verified.has(model)) return;
  settleGenerated(model);
  if (!isGenerated(model)) rejectAbstract(model);
  requireTableName(model);
  requirePrimaryKeyAttribute(model);
  rejectReservedAttributeNames(model);
  rejectBadSpecs(model);
  for (const validation of declared(model, "validations")) checkValidatedNames(model, validation);
  rejectUnknownHiddenAttributes(model);
  rejectUnknownMessageNames(model);
  rejectShadowingFields(model);
  rejectBadPageSizes(model);
  // The classes it inherits declarations from too (an app's Base), so none can change later.
  for (const each of ancestors(model)) {
    if (each === Model) break;
    seal(each);
  }
  verified.add(model);
}

function requirePrimaryKeyAttribute(model: ModelClass): void {
  if (!model.attributeDefinitions.has(model.primaryKey)) {
    throw new InvalidModel(
      `${model.name}'s primaryKey "${model.primaryKey}" isn't a declared attribute; ` +
        "declare it in Model.define({...}) or set `static primaryKey`",
    );
  }
}

function rejectReservedAttributeNames(model: ModelClass): void {
  for (const name of model.attributeDefinitions.keys()) {
    if (name in Model.prototype) {
      throw new InvalidModel(
        `${model.name} declares an attribute "${name}", which is the name of a record method or property; ` +
          "rename the attribute and map it with { column }",
      );
    }
  }
}

/**
 * A spec key its type can't have, one given with a key it conflicts with, or a storage that isn't
 * an epoch unit: the rules are in `src/spec-keys.ts`.
 */
function rejectBadSpecs(model: ModelClass): void {
  for (const [name, definition] of model.attributeDefinitions) {
    const problem = specProblem(`${model.name}.${name}`, definition);
    if (problem !== undefined) throw new InvalidModel(problem);
  }
}

/** `perPage` and `maxPerPage` are page sizes: whole numbers from 1, so the cap always holds. */
function rejectBadPageSizes(model: ModelClass): void {
  for (const name of ["perPage", "maxPerPage"] as const) {
    const size = model[name];
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new InvalidModel(
        `${model.name}'s ${name} is ${String(size)}; set it to a whole number from 1`,
      );
    }
  }
}

/**
 * A name in `hiddenAttributes` must be an attribute, so a typo doesn't leave one in the JSON.
 * Names listed by a class without attributes (the app's base class) are the exception: they
 * apply to the Models that have them (#101).
 */
function rejectUnknownHiddenAttributes(model: ModelClass): void {
  const inherited = namesListedByAttributelessAncestors(model);
  for (const name of model.hiddenAttributes) {
    if (!inherited.has(name) && !model.attributeDefinitions.has(name)) {
      throw new InvalidModel(
        `${model.name} hides "${name}" from toJSON, but has no such attribute; ` +
          "hiddenAttributes names attributes exactly",
      );
    }
  }
}

/** The `hiddenAttributes` of the classes above `model` that have no attributes of their own. */
function namesListedByAttributelessAncestors(model: ModelClass): Set<string> {
  const names = new Set<string>();
  for (const each of ancestors(model).slice(1) as Partial<ModelClass>[]) {
    if (Object.hasOwn(each, "hiddenAttributes") && hasNoAttributes(each)) {
      each.hiddenAttributes?.forEach((name) => names.add(name));
    }
  }
  return names;
}

/**
 * A Model's messages and attribute names must be for its attributes, its associations or
 * `"base"`, so a typo isn't left unused. Those of a class without attributes (the app's base
 * class) are the exception: they apply to the Models that have them (#88).
 */
function rejectUnknownMessageNames(model: ModelClass): void {
  const associations = associationsOf(model).keys();
  const known = new Set(["base", ...model.attributeDefinitions.keys(), ...associations]);
  for (const { from, declaration, names } of attributesNamedInMessages(model)) {
    const unknown = names.find((name) => !known.has(name));
    if (unknown === undefined || hasNoAttributes(from)) continue;
    const where =
      declaration === "errorMessages"
        ? "errorMessages has messages for"
        : "humanAttributeNames names";
    throw new InvalidModel(
      `${from.name}'s ${where} "${unknown}", which isn't one of its ` +
        "attributes or associations; name them exactly",
    );
  }
}

/** Whether a class has no attributes, as the app's base class: names it lists apply where a Model has them. */
function hasNoAttributes(model: Partial<ModelClass>): boolean {
  return model.attributeDefinitions?.size === 0;
}

function rejectShadowingFields(model: ModelClass): void {
  const probe = probeOf(model) as unknown as Record<string, unknown>;
  for (const name of model.attributeDefinitions.keys()) {
    // An association field with an attribute's name is reported when associations are checked.
    if (Object.hasOwn(probe, name) && declarationIn(probe[name]) === undefined) {
      throw new InvalidModel(
        `${model.name} declares a class field "${name}" that hides the attribute's accessor; ` +
          "remove it (attributes are declared in Model.define({...}))",
      );
    }
  }
}
