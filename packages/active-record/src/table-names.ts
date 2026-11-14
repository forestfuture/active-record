// A Model's table: its name (inferred, bound, or declared) and whether its queries read every column.
import type { Adapter } from "./adapter.ts";
import { ancestors } from "./ancestors.ts";
import { InvalidModel } from "./errors.ts";
import { pluralize } from "./inflections.ts";
import type { ModelClass } from "./model.ts";
import { underscore } from "./naming.ts";

/**
 * The classes `Model.define({...})` makes; their `table` is inferred unless a subclass sets one.
 * Module-level, but not request state (ADR-0003): derived only from the classes.
 */
const bases = new WeakSet<object>();

/** A generated Model's table, and whether its overrides ignore some of its columns. */
type BoundTable = { table: string; isIgnoringColumns: boolean };

/**
 * Each generated Model's table, by the class it belongs to, and whether its `static attributes`
 * ignore some of its columns (`{ notes: false }`).
 */
const boundTables = new WeakMap<object, BoundTable>();

/**
 * Each Model's answer to `isIgnoringColumns`, remembered since the compiler asks on every query.
 * Module-level, but not request state (ADR-0003): derived only from the class.
 */
const ignoring = new WeakMap<object, boolean>();

/** A class's `modelName`: its own name, unless it (or a class it extends) sets one. */
export function modelNameOf(model: object): string {
  return (model as { modelName: string }).modelName;
}

/**
 * Gives the library's base class `modelName`: each class's own name, as Rails' `model_name`,
 * unless it sets `static modelName = "…"`, which the classes extending it inherit (a set one is
 * a value, found before this getter). Empty for a class with no name: anonymous, or `export
 * default`.
 */
export function defineModelName(root: object): void {
  Object.defineProperty(root, "modelName", {
    configurable: true,
    get(this: { name: string }) {
      return this.name === "default" ? "" : this.name;
    },
    set: ownValueSetter("modelName"),
  });
}

/**
 * The `modelName` of the class that extends `base` directly, the one a table is named after, as
 * in Rails; empty when it has none (anonymous, `export default`, or `Model.define({...})` itself).
 */
function modelNameBelow(base: object, model: object): string {
  let current = model;
  while (current !== base && Object.getPrototypeOf(current) !== base) {
    current = Object.getPrototypeOf(current);
  }
  return current === base ? "" : modelNameOf(current);
}

/**
 * A class name's table, by Rails' `tableize`: the name through `underscore`, pluralized
 * (`BlogPost` → `blog_posts`, `Person` → `people`). The generators name tables with it too.
 */
export function tableize(className: string): string {
  return pluralize(underscore(className));
}

/**
 * The setter of a static that a class can set for itself: an assignment (a static block, or a
 * class field compiled without useDefineForClassFields) gives that class its own value, as
 * `static table = "…"` does.
 */
export function ownValueSetter(name: string): (this: object, value: unknown) => void {
  return function (this: object, value: unknown): void {
    Object.defineProperty(this, name, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  };
}

/**
 * Gives the classes extending `base` (one `define` made) an inferred `table`, by `tableize`. A
 * subclass shares its parent's; `static table = "…"` anywhere in the chain overrides it.
 */
export function inferTableNames(base: object): void {
  bases.add(base);
  Object.defineProperty(base, "table", {
    configurable: true,
    get(this: object) {
      const name = modelNameBelow(base, this);
      return name === "" ? "" : tableize(name);
    },
    set: ownValueSetter("table"),
  });
}

/** The modelName a Model's table name was inferred from, or undefined when it's declared. */
function tableNameSource(model: object): string | undefined {
  const owner = ancestors(model).find((each) => Object.hasOwn(each, "table"));
  return owner !== undefined && bases.has(owner) && !boundTables.has(owner)
    ? modelNameBelow(owner, model)
    : undefined;
}

/**
 * Binds a generated Model's table to the class it belongs to: a subclass can't name another,
 * since the attributes are that table's columns; and records whether its overrides ignore some
 * columns.
 */
export function bindTable(
  owner: { table?: string },
  table: string,
  { isIgnoringColumns }: { isIgnoringColumns: boolean },
): void {
  owner.table = table;
  boundTables.set(owner, { table, isIgnoringColumns });
}

/** The table bound to the class `model` is, or extends, if any. */
function boundTableOf(model: object): (BoundTable & { owner: object }) | undefined {
  const owner = ancestors(model).find((each) => boundTables.has(each));
  return owner && { ...boundTables.get(owner)!, owner };
}

/**
 * Whether a Model ignores some of its table's columns, so its queries name their columns rather
 * than `*` and an ignored column is never read, as in Rails. The nearest bound table decides.
 * Remembered per Model: its table is bound when it's first used, before any query, so the
 * answer can't change.
 */
export function isIgnoringColumns(model: object): boolean {
  let answer = ignoring.get(model);
  if (answer === undefined) {
    answer = boundTableOf(model)?.isIgnoringColumns ?? false;
    ignoring.set(model, answer);
  }
  return answer;
}

/**
 * An abstract base class (the app's `ApplicationRecord`, or one marked `static abstract = true`)
 * has no table, as Rails' `abstract_class`: it's only inherited from, so using it is an
 * `InvalidModel`.
 */
export function rejectAbstract(model: ModelClass): void {
  if (ancestors(model).some((each) => bases.has(each))) return;
  const example = model.name ? `, such as class Product extends ${model.name} {}` : "";
  throw new InvalidModel(
    `${model.name || "This class"} is an abstract base class, with no table; use a Model that ` +
      `extends it${example}`,
  );
}

/** A Model's `modelName` must be a string, since names are made from it and the schema lists it by it. */
export function requireModelName(model: ModelClass): void {
  if (typeof model.modelName === "string") return;
  throw new InvalidModel(
    `${model.name}'s modelName must be a string; remove it to use the class name`,
  );
}

/** A Model must have a table name: its own, or one inferred from its modelName. */
export function requireTableName(model: ModelClass): void {
  const { table } = model;
  const bound = boundTableOf(model);
  if (bound !== undefined && table !== bound.table) {
    throw new InvalidModel(
      `${model.name} sets table "${String(table)}", but its attributes are the ${bound.table} ` +
        `table's, as ${(bound.owner as { name: string }).name}'s are; a subclass shares its parent's table`,
    );
  }
  if (typeof table === "string" && table !== "") return;
  throw new InvalidModel(
    tableNameSource(model) === ""
      ? `${model.name || "A Model class"} has no class name to infer its table from; set static table, or static modelName`
      : `${model.name}'s table must be a table's name; remove it to use the one inferred from its modelName`,
  );
}

/**
 * A database's "no such table" for a table whose name was inferred, as an `InvalidModel` saying where
 * the name came from (a bundler may have renamed the class). Any other error is returned as is.
 */
export function explainMissingTable(
  adapter: Adapter,
  error: unknown,
  models: readonly ModelClass[],
): unknown {
  const table = adapter.missingTable(error);
  const model = models.find((each) => each.table === table && tableNameSource(each));
  const source = model && tableNameSource(model);
  if (table === undefined || model === undefined) return error;
  return new InvalidModel(
    `${model.name}'s table "${table}" doesn't exist in ${adapter.name} (inferred from the modelName ` +
      `${source}; create it, set static table, or set static modelName if your ` +
      "bundler renames classes)",
    { cause: error },
  );
}

/**
 * The name a Model's foreign keys are inferred from: the `modelName` of the class whose table
 * it is (`Post`, for `class FeaturedPost extends Post {}`).
 */
export function tableOwnerModelName(model: object): string {
  const base = ancestors(model).find((each) => bases.has(each));
  if (base !== undefined) return modelNameBelow(base, model);
  return modelNameOf(boundTableOf(model)?.owner ?? model);
}
