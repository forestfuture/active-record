// An enum attribute's methods (#340): a record's predicates (`isPublished()`) and `saveAs…` setters,
// a Model's scopes (`published()`, `notPublished()`), and their names.
import { enumEntries, type EnumModel, type EnumNames, type EnumValues } from "./enum-values.ts";
import type { AttributeDefinition } from "./metadata.ts";
import type { ScopeStatic } from "./model.ts";

/** `S` in camelCase, as a method names it: `in_progress` → `inProgress`. */
type CamelCase<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : S;

/** How a word reads inside a method's name: `in_progress` → `InProgress`. */
type MethodPart<N extends string> = Capitalize<CamelCase<N>>;

/** A `prefix` or `suffix` in a method's name: the attribute's name for `true`, else the word given. */
type Affix<K, A> = A extends true ? MethodPart<K & string> : A extends string ? MethodPart<A> : "";

/** The option `O` of a spec, if it gives one. */
type OptionOf<S, O extends string> = S extends { readonly [key in O]: infer V } ? V : undefined;

/**
 * Each name of attribute `K`'s enum as its methods name it, its prefix and suffix around it
 * (`StatusActive`, `ActiveLevel`), or never for an attribute with no enum.
 */
type Stems<K, S> = S extends { enum: infer E extends EnumValues }
  ? `${Affix<K, OptionOf<S, "prefix">>}${MethodPart<EnumNames<E>>}${Affix<K, OptionOf<S, "suffix">>}`
  : never;

/** Every stem the enums of the specs `A` give a record's methods, unless one says `instanceMethods: false`. */
type RecordStems<A> = {
  [K in keyof A]: A[K] extends { instanceMethods: false } ? never : Stems<K, A[K]>;
}[keyof A];

/** Every stem the enums of the specs `A` give a Model's scopes, unless one says `scopes: false`. */
type ScopeStems<A> = {
  [K in keyof A]: A[K] extends { scopes: false } ? never : Stems<K, A[K]>;
}[keyof A];

/**
 * What the enums of the specs `A` add to a record: a predicate for each name, and a setter that
 * assigns it and saves, with its `OrThrow`, as Rails' `published!` updates the record.
 */
export type EnumMethods<A> = { [P in `is${RecordStems<A>}`]: () => boolean } & {
  [P in `saveAs${RecordStems<A>}`]: () => Promise<boolean>;
} & { [P in `saveAs${RecordStems<A>}OrThrow`]: () => Promise<true> };

/** What the enums of the specs `A` add to a Model: a scope for each name, and a `not…` scope. */
export type EnumStatics<A> = {
  [P in Uncapitalize<ScopeStems<A>> | `not${ScopeStems<A>}`]: ScopeStatic<[]>;
};

/**
 * One name of an enum attribute, and the methods it gives (#340): on records, its predicate and
 * setters, and on its Model, its scope and `not…` scope; none of either it's declared without.
 */
interface EnumName {
  attribute: string;
  name: string;
  /** `isPublished`, `saveAsPublished`, `saveAsPublishedOrThrow`, as `EnumMethods` types them. */
  records: string[];
  /** `published`, `notPublished`, as `EnumStatics` types them. */
  scopes: string[];
}

/** Each name of every enum attribute, with the methods it gives. */
function enumNames(definitions: ReadonlyMap<string, AttributeDefinition>): EnumName[] {
  return [...definitions].flatMap(([attribute, definition]) => {
    if (definition.enum === undefined) return [];
    const before = affix(attribute, definition.prefix);
    const after = affix(attribute, definition.suffix);
    return enumEntries(definition.enum).map(([name]) => {
      const stem = `${before}${methodPart(name)}${after}`;
      const records = [`is${stem}`, `saveAs${stem}`, `saveAs${stem}OrThrow`];
      const scopes = [uncapitalized(stem), `not${stem}`];
      return {
        attribute,
        name,
        records: definition.instanceMethods === false ? [] : records,
        scopes: definition.scopes === false ? [] : scopes,
      };
    });
  });
}

function affix(attribute: string, option: boolean | string | undefined): string {
  if (option === true) return methodPart(attribute);
  return typeof option === "string" ? methodPart(option) : "";
}

/** The scopes the enums of `definitions` give a Model, as `EnumStatics` types them. */
export function enumScopeNames(definitions: ReadonlyMap<string, AttributeDefinition>): string[] {
  return enumNames(definitions).flatMap(({ scopes }) => scopes);
}

/** How a word reads inside a method's name, as `MethodPart` types it. */
function methodPart(word: string): string {
  const [head = "", ...rest] = word.split("_");
  return capitalized(head + rest.map(capitalized).join(""));
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const uncapitalized = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** What a record's setters call: its `update` and `updateOrThrow`. */
interface Updatable {
  update(attributes: Record<string, unknown>): Promise<boolean>;
  updateOrThrow(attributes: Record<string, unknown>): Promise<true>;
}

/**
 * Defines each enum attribute's methods on `prototype`: `isPublished()` is `status === "published"`,
 * and `saveAsPublished()` is `update({ status: "published" })`, so it saves the record's other
 * changes too, as Rails' `published!` does.
 */
export function defineEnumMethods(
  prototype: object,
  definitions: ReadonlyMap<string, AttributeDefinition>,
): void {
  for (const { attribute, name, records } of enumNames(definitions)) {
    const [predicate, setter, throwingSetter] = records;
    if (predicate === undefined) continue;
    defineMethod(prototype, predicate, function (this: Record<string, unknown>) {
      return this[attribute] === name;
    });
    defineMethod(prototype, setter!, function (this: Updatable) {
      return this.update({ [attribute]: name });
    });
    defineMethod(prototype, throwingSetter!, function (this: Updatable) {
      return this.updateOrThrow({ [attribute]: name });
    });
  }
}

/** The class an enum's scopes are declared on: what `this.scope(…)` is called on. */
interface ScopeDeclaring {
  scope(body: (relation: Conditioned) => Conditioned): (...args: never[]) => unknown;
}

/** The part of a Relation an enum's scopes use. */
interface Conditioned {
  where(conditions: Record<string, unknown>): Conditioned;
  whereNot(conditions: Record<string, unknown>): Conditioned;
}

/**
 * Defines each enum attribute's scopes on `model`, as `this.scope(…)` statics: `published()` is
 * `where({ status: "published" })`, and `notPublished()` is `whereNot(…)`, as Rails' are.
 */
export function defineEnumStatics(
  model: object,
  definitions: ReadonlyMap<string, AttributeDefinition>,
): void {
  const declaring = model as ScopeDeclaring;
  for (const { attribute, name, scopes } of enumNames(definitions)) {
    const [only, without] = scopes;
    if (only === undefined) continue;
    const onlyScope = declaring.scope((q) => q.where({ [attribute]: name }));
    const withoutScope = declaring.scope((q) => q.whereNot({ [attribute]: name }));
    enumScopes.add(onlyScope);
    enumScopes.add(withoutScope);
    defineMethod(model, only, onlyScope, { named: false });
    defineMethod(model, without!, withoutScope, { named: false });
  }
}

/** Puts `method` on `target` as `name`, writable as a declared method is, and names it unless told not to. */
function defineMethod(
  target: object,
  name: string,
  method: (...args: never[]) => unknown,
  { named = true } = {},
): void {
  // What's there already is never replaced: an attribute's accessor, or a static or method a
  // generated Model declares itself, whose class is where its enum's methods go. A clashing
  // static or attribute is refused when the Model is first used; a record method is its own.
  if (Object.hasOwn(target, name)) return;
  if (named) Object.defineProperty(method, "name", { value: name });
  Object.defineProperty(target, name, { value: method, writable: true, configurable: true });
}

/** The scope statics `defineEnumStatics` made, so a static a Model declares itself is told apart. */
const enumScopes = new WeakSet<object>();

/** What an enum's method names mustn't take, besides each other's. */
export interface TakenNames {
  /** Whether a record already has `name`: a record method or property. */
  isRecordName(name: string): boolean;
  /** Whether a scope can't be named `name`: a Relation method or a Model static. */
  isReservedStatic(name: string): boolean;
  /** How the Model (or a class it extends below the library's) declares the static `name`. */
  staticOf(name: string): PropertyDescriptor | undefined;
}

/**
 * Why an enum's method names can't be as they are, or undefined: two enums give one name, or one
 * takes the name of a record method, an attribute, a Relation method, a Model static, or a static
 * the Model declares itself. Rails refuses the same when an enum is declared.
 */
export function enumNameProblem(model: EnumModel, taken: TakenNames): string | undefined {
  const givenBy = new Map<string, string>();
  for (const each of enumNames(model.attributeDefinitions)) {
    const { attribute, records, scopes } = each;
    for (const method of [...records, ...scopes]) {
      const other = givenBy.get(method);
      if (other !== undefined) return repeated(model.name, other, attribute, method);
      givenBy.set(method, attribute);
    }
    const problem =
      declarableProblem(model, each, [...records, ...scopes]) ??
      recordProblem(model, attribute, records, taken) ??
      staticProblem(model, attribute, scopes, taken);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/** A JavaScript identifier, which `active-record schema` can declare a static by. */
const identifier = /^[A-Za-z_$][\w$]*$/;

/** Words a declaration can't be named, in a module (strict mode). */
const reservedWords = new Set(
  (
    "await break case catch class const continue debugger default delete do else enum export " +
    "extends false finally for function if implements import in instanceof interface let new " +
    "null package private protected public return static super switch this throw true try " +
    "typeof var void while with yield arguments eval"
  ).split(" "),
);

/**
 * A method name an enum's name gives that TypeScript can't declare (#340): one that isn't an
 * identifier (`isIn-progress`), or a scope that's a reserved word (`new`), which the generated
 * schema couldn't declare as a static.
 */
function declarableProblem(
  model: EnumModel,
  { attribute, name }: EnumName,
  methods: readonly string[],
): string | undefined {
  const undeclarable = methods.find((method) => !identifier.test(method));
  if (undeclarable !== undefined) {
    const suggested = uncapitalized(methodPart(name.split(/[^\w$]+/).join("_")));
    return `${model.name}'s enum ${attribute} gives a method named "${undeclarable}", which isn't a name TypeScript can declare; name it with letters, digits, _ and $, and map it to the value it's stored as ({ ${suggested}: ${JSON.stringify(name)} })`;
  }
  const reserved = methods.find((method) => reservedWords.has(method));
  return reserved === undefined
    ? undefined
    : `${model.name}'s enum ${attribute} gives a scope named "${reserved}", which is a reserved word; ${remedy(attribute)}`;
}

function repeated(model: string, first: string, second: string, method: string): string {
  return first === second
    ? `${model}'s enum ${first} gives "${method}" for two of its names; rename one`
    : `${model}'s enums ${first} and ${second} both give a method named "${method}"; give one a prefix or a suffix`;
}

const remedy = (attribute: string) => `give ${attribute} a prefix or a suffix`;

function recordProblem(
  model: EnumModel,
  attribute: string,
  methods: readonly string[],
  taken: TakenNames,
): string | undefined {
  for (const method of methods) {
    const what = model.attributeDefinitions.has(method)
      ? "an attribute"
      : taken.isRecordName(method)
        ? "a record method"
        : undefined;
    if (what !== undefined) {
      return `${model.name}'s enum ${attribute} gives a method named "${method}", which is the name of ${what}; ${remedy(attribute)}`;
    }
  }
  return undefined;
}

function staticProblem(
  model: EnumModel,
  attribute: string,
  scopes: readonly string[],
  taken: TakenNames,
): string | undefined {
  for (const scope of scopes) {
    // A Function method too: every class has it, and a scope would hide it.
    if (taken.isReservedStatic(scope) || scope in Function.prototype) {
      return `${model.name}'s enum ${attribute} gives a scope named "${scope}", which is the name of a Relation method or a Model static; ${remedy(attribute)}`;
    }
    const declared = taken.staticOf(scope);
    const isEnumScope = typeof declared?.value === "function" && enumScopes.has(declared.value);
    if (declared !== undefined && !isEnumScope) {
      return `${model.name} declares "${scope}", which is also the name of a scope its enum ${attribute} gives; rename it, or ${remedy(attribute)}`;
    }
  }
  return undefined;
}
