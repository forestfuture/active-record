// A Model's own validation contexts (#51): `static validationContexts`, and refusing a context it doesn't list.
import { ancestors } from "./ancestors.ts";
import { declaredByClass } from "./declarations.ts";
import { InvalidModel } from "./errors.ts";
import { isBase } from "./generated-model.ts";
import {
  BUILT_IN_CONTEXTS,
  contextsOfCallback,
  listOf,
  type ValidationContexts,
} from "./validation-context.ts";

/** The custom contexts a Model lists in `static validationContexts`, if any. */
function listedBy(model: object): readonly string[] {
  return (model as { validationContexts?: readonly string[] }).validationContexts ?? [];
}

/** The contexts a Model may name: `"create"`, `"update"` and those it lists. */
function knownBy(model: object): readonly string[] {
  return [...BUILT_IN_CONTEXTS, ...listedBy(model)];
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

/** A context named by a Model's validations or validation callbacks: the class that named it, and how. */
interface Named {
  from: { name: string };
  what: string;
  contexts: readonly string[];
}

/** Each context a Model's validations and validation callbacks name, by the class declaring each. */
function namedContexts(model: object): Named[] {
  const validations = declaredByClass(model, "validations").flatMap(({ from, values }) =>
    values.map(({ attribute, options, associated }) => ({
      from: from as { name: string },
      what: associated ? ` validates the associated "${attribute}"` : ` validates "${attribute}"`,
      contexts: [options.on ?? [], options.exceptOn ?? []].flatMap(listOf),
    })),
  );
  const callbacks = (["beforeValidation", "afterValidation"] as const).flatMap((kind) =>
    declaredByClass(model, kind).flatMap(({ from, values }) =>
      values.map((callback) => ({
        from: from as { name: string },
        what: `'s ${kind} runs`,
        contexts: contextsOfCallback(callback),
      })),
    ),
  );
  return [...validations, ...callbacks];
}

/** A context named on an abstract base class, which has only `"create"` and `"update"`. */
function namedOnBase({ from, what }: Named, name: string): InvalidModel {
  return new InvalidModel(
    `${from.name}${what} on "${name}", but an abstract base class has only "create" and "update"; ` +
      `declare it on each Model that lists "${name}"`,
  );
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
  for (const named of namedContexts(model)) {
    const onBase = isBase(named.from);
    const known = onBase ? BUILT_IN_CONTEXTS : knownBy(model);
    const name = named.contexts.find((context) => !known.includes(context));
    if (name === undefined) continue;
    throw onBase ? namedOnBase(named, name) : unlisted(model, named.what, name);
  }
}

/**
 * Refuses a context given to `isValid` or `save` that the record's Model doesn't list, with a
 * `TypeError`: a misspelled one would otherwise run none of the rules declared for it.
 */
export function requireKnownContexts(record: object, given: ValidationContexts | undefined): void {
  if (given === undefined) return;
  const model = record.constructor as { name: string };
  const known = knownBy(model);
  const name = listOf(given).find((context) => !known.includes(context));
  if (name === undefined) return;
  throw new TypeError(
    `${model.name} has no validation context "${name}"; list it in static validationContexts`,
  );
}
