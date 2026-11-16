// A Model's own validation contexts (#51): `static validationContexts`, and refusing a context it doesn't list.
import { ancestors } from "./ancestors.ts";
import { declared } from "./declarations.ts";
import { InvalidModel } from "./errors.ts";
import { isBase } from "./generated-model.ts";
import { contextsOfCallback, listOf } from "./validation-context.ts";

/** The contexts every Model has. */
const BUILT_IN = ["create", "update"];

/** The custom contexts a Model lists in `static validationContexts`, if any. */
function listedBy(model: object): readonly string[] {
  return (model as { validationContexts?: readonly string[] }).validationContexts ?? [];
}

/** The contexts a Model may name: `"create"`, `"update"` and those it lists. */
function knownBy(model: object): readonly string[] {
  return [...BUILT_IN, ...listedBy(model)];
}

/** Why `name` isn't one of the Model's contexts, said after what named it. */
function unlisted(model: { name: string }, what: string, name: string): InvalidModel {
  const listed = listedBy(model);
  const among =
    listed.length === 0
      ? `"create" or "update"`
      : `"create", "update" or one of its validationContexts (${listed.map((each) => `"${each}"`).join(", ")})`;
  return new InvalidModel(
    `${model.name}${what} on "${name}", which isn't ${among}; list it in static validationContexts`,
  );
}

/** Each context a Model's validations and validation callbacks name, with what names it. */
function namedContexts(model: object): { what: string; contexts: readonly string[] }[] {
  const validations = declared(model, "validations").map(({ attribute, options, associated }) => ({
    what: associated ? ` validates the associated "${attribute}"` : ` validates "${attribute}"`,
    contexts: [options.on ?? [], options.exceptOn ?? []].flatMap(listOf),
  }));
  const callbacks = (["beforeValidation", "afterValidation"] as const).flatMap((kind) =>
    declared(model, kind).map((callback) => ({
      what: `'s ${kind} runs`,
      contexts: contextsOfCallback(callback),
    })),
  );
  return [...validations, ...callbacks];
}

/**
 * Checks, on a Model's first use, that its validations and validation callbacks name only its
 * contexts, and that no abstract class it extends lists any: `InvalidModel` otherwise.
 */
export function rejectUnlistedContexts(model: { name: string }): void {
  for (const each of ancestors(model)) {
    if (isBase(each) && Object.hasOwn(each, "validationContexts")) {
      throw new InvalidModel(
        `${(each as { name: string }).name} is an abstract base class; list validationContexts on each Model instead`,
      );
    }
  }
  const known = knownBy(model);
  for (const { what, contexts } of namedContexts(model)) {
    const name = contexts.find((context) => !known.includes(context));
    if (name !== undefined) throw unlisted(model, what, name);
  }
}
