// A Model's own validation contexts (#51): `static validationContexts`, and refusing a context it doesn't list.
import { ancestors } from "./ancestors.ts";
import { declaredByClass } from "./declarations.ts";
import { InvalidModel } from "./errors.ts";
import { isBase } from "./generated-model.ts";
import {
  BUILT_IN_CONTEXTS,
  contextsOfCallback,
  listOf,
  VALIDATION_CALLBACK_KINDS,
  type ValidationContexts,
} from "./validation-context.ts";

/** A class's name. */
function nameOf(model: object): string {
  return (model as { name: string }).name;
}

/** The custom contexts a Model lists in `static validationContexts`, if any. */
function listedBy(model: object): readonly string[] {
  return (model as { validationContexts?: readonly string[] }).validationContexts ?? [];
}

/** The contexts a Model may name: `"create"`, `"update"` and those it lists. */
function knownBy(model: object): readonly string[] {
  return [...BUILT_IN_CONTEXTS, ...listedBy(model)];
}

/** Why `name`, named by `subject` ("Member validates \"email\""), isn't one of the Model's contexts. */
function unlisted(model: object, subject: string, name: string): InvalidModel {
  const listed = listedBy(model);
  const among =
    listed.length === 0
      ? `"create" or "update"`
      : `"create", "update" or one of its validationContexts (${listed.map((each) => `"${each}"`).join(", ")})`;
  return new InvalidModel(
    `${subject} on "${name}", which isn't ${among}; list it in static validationContexts`,
  );
}

/**
 * Contexts named by one of a Model's validations or validation callbacks: the class that declared
 * it, and what it is, as an error's subject ("Member validates \"email\"").
 */
interface Named {
  from: object;
  subject: string;
  contexts: readonly string[];
}

/** Each context a Model's validations and validation callbacks name, by the class declaring each. */
function namedContexts(model: object): Named[] {
  const validations = declaredByClass(model, "validations").flatMap(({ from, values }) =>
    values.map(({ attribute, options, associated }) => ({
      from,
      subject: `${nameOf(from)} validates ${associated ? "the associated " : ""}"${attribute}"`,
      contexts: [options.on ?? [], options.exceptOn ?? []].flatMap(listOf),
    })),
  );
  const callbacks = VALIDATION_CALLBACK_KINDS.flatMap((kind) =>
    declaredByClass(model, kind).flatMap(({ from, values }) =>
      values.map((callback) => ({
        from,
        subject: `${nameOf(from)}'s ${kind} runs`,
        contexts: contextsOfCallback(callback),
      })),
    ),
  );
  return [...validations, ...callbacks];
}

/** A context named on an abstract base class, which has only `"create"` and `"update"`. */
function namedOnBase({ subject }: Named, name: string): InvalidModel {
  return new InvalidModel(
    `${subject} on "${name}", but an abstract base class has only "create" and "update"; ` +
      `declare it on each Model that lists "${name}"`,
  );
}

/**
 * Checks, on a Model's first use, that its validations and validation callbacks name only its
 * contexts, and that no abstract class it extends lists any: `InvalidModel` otherwise.
 */
export function rejectUnlistedContexts(model: object): void {
  for (const each of ancestors(model)) {
    if (isBase(each) && Object.hasOwn(each, "validationContexts")) {
      throw new InvalidModel(
        `${nameOf(each)} is an abstract base class; list validationContexts on each Model instead`,
      );
    }
  }
  for (const named of namedContexts(model)) {
    const onBase = isBase(named.from);
    const known = onBase ? BUILT_IN_CONTEXTS : knownBy(model);
    const name = named.contexts.find((context) => !known.includes(context));
    if (name === undefined) continue;
    throw onBase ? namedOnBase(named, name) : unlisted(model, named.subject, name);
  }
}

/**
 * Refuses a context given to `isValid` or `save` that the record's Model doesn't list, with a
 * `TypeError`: a misspelled one would otherwise run none of the rules declared for it.
 */
export function requireKnownContexts(record: object, given: ValidationContexts | undefined): void {
  if (given === undefined) return;
  const model = record.constructor;
  const known = knownBy(model);
  const name = listOf(given).find((context) => !known.includes(context));
  if (name === undefined) return;
  throw new TypeError(
    `${nameOf(model)} has no validation context "${name}"; list it in static validationContexts`,
  );
}
