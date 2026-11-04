// Error messages: the built-in English ones, a Model's own, and looking one up when it's read (#88).
import { declaredByClass, isSealed } from "./declarations.ts";
import type { ModelClass } from "./model.ts";
import { FILTERED, isFiltered } from "./filtering.ts";
import { underscore } from "./naming.ts";

/**
 * An error's message, after the attribute's name: `"can't be blank"`. With a count, one for
 * each plural form: `{ one: "needs 1 character", other: "needs %{count} characters" }`.
 */
export type ErrorMessage = string | { readonly one?: string; readonly other: string };

/** The messages of `restrictDependentDestroy`, for a has-one and a has-many association. */
export interface RestrictMessages {
  readonly hasOne: string;
  readonly hasMany: string;
}

/** Messages by attribute name (`N`: the names a Model has), then error type. */
export type AttributeErrorMessages<N extends string = string> = {
  readonly [K in N]?: { readonly [type: string]: ErrorMessage };
};

/**
 * What `errorMessages` declares: messages by error type (`blank`, `tooShort`, or a type of your
 * own), and under `attributes`, by attribute and type, which win over the class's others.
 */
export interface ErrorMessages<N extends string = string> {
  readonly [type: string]: ErrorMessage | RestrictMessages | AttributeErrorMessages<N> | undefined;
  readonly attributes?: AttributeErrorMessages<N>;
  readonly restrictDependentDestroy?: RestrictMessages;
}

/** @internal Rails' English messages, used where no class has its own (listed in the guide). */
export const builtInMessages: ErrorMessages = {
  blank: "can't be blank",
  invalid: "is invalid",
  inclusion: "is not included in the list",
  taken: "has already been taken",
  tooShort: {
    one: "is too short (minimum is 1 character)",
    other: "is too short (minimum is %{count} characters)",
  },
  tooLong: {
    one: "is too long (maximum is 1 character)",
    other: "is too long (maximum is %{count} characters)",
  },
  wrongLength: {
    one: "is the wrong length (should be 1 character)",
    other: "is the wrong length (should be %{count} characters)",
  },
  notANumber: "is not a number",
  notAnInteger: "must be an integer",
  greaterThan: "must be greater than %{count}",
  greaterThanOrEqualTo: "must be greater than or equal to %{count}",
  lessThan: "must be less than %{count}",
  lessThanOrEqualTo: "must be less than or equal to %{count}",
  restrictDependentDestroy: {
    hasOne: "Cannot delete record because a dependent %{record} exists",
    hasMany: "Cannot delete record because dependent %{record} exist",
  },
};

/** The values an error's message can show as `%{name}`, such as `count`. */
export type ErrorValues = Readonly<Record<string, string | number>>;

/** One error, as `Errors` keeps it: its message is looked up when it's read, unless it's given. */
export interface ErrorEntry {
  attribute: string;
  type: string;
  values: ErrorValues;
  /** A message given as text, used as it is. */
  message?: string;
  /** The message's form to use, such as `restrictDependentDestroy`'s `hasOne`; else `count`'s plural form. */
  form?: string;
}

/** Where an error's message comes from: the record's Model, and its values for `%{value}`. */
export interface MessageSource {
  model: ModelClass;
  read: (attribute: string) => unknown;
}

/** A message as a class declares it, for one type: its text, or its forms by name. */
type Template = string | { readonly [form: string]: string | undefined };

const plurals = new Intl.PluralRules("en");

/** `object[key]` when it's the object's own, so `toString` is never a message. */
function ownValue<T>(
  object: { readonly [key: string]: T } | undefined,
  key: string,
): T | undefined {
  return object !== undefined && Object.hasOwn(object, key) ? object[key] : undefined;
}

/** One class's `errorMessages` calls as one: a later call's message wins, type by type. */
function mergedCalls(calls: readonly ErrorMessages[]): ErrorMessages {
  const attributes: Record<string, Record<string, ErrorMessage>> = {};
  for (const call of calls) {
    for (const [name, types] of Object.entries(call.attributes ?? {})) {
      attributes[name] = { ...attributes[name], ...types };
    }
  }
  return Object.assign({}, ...calls, { attributes }) as ErrorMessages;
}

/** A Model's messages, each class's calls as one, nearest class first, then the built-in ones; and its attribute names. */
interface Catalog {
  messages: readonly ErrorMessages[];
  names: ReadonlyMap<string, string>;
}

// Module-level, but not request state (ADR-0003): a sealed Model's declarations never change.
const catalogs = new WeakMap<ModelClass, Catalog>();

/** A Model's catalog, built once it's sealed; before that, built afresh, as declarations can still come. */
function catalogOf(model: ModelClass): Catalog {
  const kept = catalogs.get(model);
  if (kept !== undefined) return kept;
  const names = new Map<string, string>();
  // The base class first, each class's calls in order, so the nearest class's latest name wins.
  for (const { values } of declaredByClass(model, "humanAttributeNames").toReversed()) {
    for (const value of values) {
      for (const [attribute, name] of Object.entries(value)) names.set(attribute, name);
    }
  }
  const byClass = declaredByClass(model, "errorMessages");
  const messages = [...byClass.map(({ values }) => mergedCalls(values)), builtInMessages];
  const catalog = { messages, names };
  if (isSealed(model)) catalogs.set(model, catalog);
  return catalog;
}

/** The message for a type: for the attribute, then the class's own, nearest class first (Rails' order). */
function templateFor(model: ModelClass, attribute: string, type: string): Template | undefined {
  if (type === "attributes") return undefined;
  for (const messages of catalogOf(model).messages) {
    const found =
      ownValue(ownValue(messages.attributes, attribute), type) ?? ownValue(messages, type);
    if (found !== undefined) return found as Template;
  }
  return undefined;
}

/** The text of a message: the form the entry names, or else the plural form for `count`. */
function messageText(template: Template | undefined, entry: ErrorEntry): string | undefined {
  if (template === undefined || typeof template === "string") return template;
  const { count } = entry.values;
  const form = entry.form ?? (typeof count === "number" ? plurals.select(count) : "other");
  return ownValue(template, form) ?? template.other;
}

/** "createdAt" → "Created at" */
function inWords(name: string): string {
  const words = underscore(name).replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An attribute's name as messages show it: a class's `humanAttributeNames`, or "Created at". */
export function humanAttributeName(model: ModelClass, attribute: string): string {
  return catalogOf(model).names.get(attribute) ?? inWords(attribute);
}

/** An attribute's value as `%{value}` shows it. */
function shownValue(source: MessageSource, attribute: string): string {
  if (attribute === "base") return "";
  const value = source.read(attribute);
  if (value === null || value === undefined) return "";
  if (isFiltered(source.model, attribute)) return FILTERED;
  if (value instanceof Date) return value.toISOString();
  return typeof value === "object" ? JSON.stringify(value) : String(value as string | number);
}

/** An entry's message: given, or looked up now, with its `%{name}` placeholders filled in. */
export function messageOf(source: MessageSource, entry: ErrorEntry): string {
  if (entry.message !== undefined) return entry.message;
  const { model } = source;
  const text = messageText(templateFor(model, entry.attribute, entry.type), entry);
  if (text === undefined) throw missingMessage(model, entry);
  return text.replace(/%\{(\w+)\}/g, (placeholder, name: string) => {
    if (name === "attribute") return humanAttributeName(model, entry.attribute);
    if (name === "model") return inWords(model.name);
    if (name === "value") return shownValue(source, entry.attribute);
    return String(ownValue(entry.values, name) ?? placeholder);
  });
}

/** The error for a type no class has a message for. */
function missingMessage(model: ModelClass, entry: ErrorEntry): TypeError {
  const where = `${model.name}'s errorMessages, or a class it extends`;
  return new TypeError(
    `No message for the error "${entry.type}" on "${entry.attribute}": add one to ${where}, ` +
      `as ${entry.type} or attributes.${entry.attribute}.${entry.type}`,
  );
}

/** The attributes each class names in its `errorMessages` or `humanAttributeNames`, nearest class first. */
export function attributesNamedInMessages(
  model: ModelClass,
): { from: ModelClass; declaration: "errorMessages" | "humanAttributeNames"; names: string[] }[] {
  return [
    ...declaredByClass(model, "errorMessages").map(({ from, values }) => ({
      from: from as ModelClass,
      declaration: "errorMessages" as const,
      names: values.flatMap((value) => Object.keys(value.attributes ?? {})),
    })),
    ...declaredByClass(model, "humanAttributeNames").map(({ from, values }) => ({
      from: from as ModelClass,
      declaration: "humanAttributeNames" as const,
      names: values.flatMap((value) => Object.keys(value)),
    })),
  ];
}
