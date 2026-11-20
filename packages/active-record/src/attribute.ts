// An attribute's value path (#94, #163): cast, refused, stored, read, and bound in one place.
// `attributeFor(model, name)` resolves an attribute once per Model class; its methods cast a
// value by how it reaches the attribute, refuse with an error that names it, put it in the form
// D1 stores, read a cell back, and bind it hidden from listeners when the attribute is filtered.
// Records, Relations, associations, preloads, and the compiler all go through here, so no caller
// has to cast or bind a value its own way.
import { isSameCell } from "./binary-values.ts";
import {
  castCondition,
  castKey,
  castValue,
  isInvalidDate,
  readValue,
  uncastable,
  writeValue,
} from "./conversion.ts";
import { listedNames } from "./enum-values.ts";
import { FILTERED, Filtered, isFiltered } from "./filtering.ts";
import {
  type AttributeDefinition,
  type AttributeType,
  attributeOf,
  columnOf,
  requireDefined,
} from "./metadata.ts";
import type { ModelClass } from "./model.ts";
import { refuseThenable } from "./thenables.ts";
import { normalizationsOf } from "./normalization.ts";

/** What `condition()` and `conditionCell()` give for a value that can't match anything. */
export const noMatch = uncastable;

/**
 * One attribute's value path, resolved once per Model class by `attributeFor` (#163). Which
 * Model and attribute a refusal names, whether the attribute is filtered, and how its type is
 * stored are known here, so a caller only says what the value is for.
 */
export class Attribute {
  readonly #model: ModelClass;
  readonly name: string;
  readonly #definition: AttributeDefinition;

  /** @internal Use `attributeFor`. */
  constructor(model: ModelClass, name: string) {
    this.#model = model;
    this.name = name;
    this.#definition = attributeOf(model, name);
  }

  /** Its column; `UnknownAttribute` for a virtual attribute, which has none (#356). */
  get column(): string {
    return columnOf(this.#model, this.name).column;
  }

  /** Whether it's a `string` attribute, which D1 compares as text, not by number. */
  get isText(): boolean {
    return this.#definition.type === "string";
  }

  /** Whether it's a `binary` attribute, whose cells are bytes, which JSON can't hold (#20). */
  get isBinary(): boolean {
    return this.#definition.type === "binary";
  }

  /** Whether it's a `json` attribute, whose stored text is JSON itself. */
  get isJson(): boolean {
    return this.#definition.type === "json";
  }

  /**
   * An assigned value (a setter, `build`, `update`, `insert`, `permit`) as the attribute's type:
   * only what's unambiguous for it (#81). `undefined` throws, as it would store NULL silently;
   * what can't be cast throws `TypeError` naming the Model and attribute, showing the value
   * unless the attribute is filtered (#83).
   */
  cast(value: unknown): unknown {
    requireDefined(this.#model, this.name, value);
    const cast = this.#convertOrRefuse(value, () => castValue(this.#definition, value));
    // A validated enum keeps an unknown value for its validation to refuse (#340).
    if (cast === uncastable && this.#isValidatedEnum()) return value;
    return this.#orRefuse(cast, value);
  }

  /** An assigned value cast, then normalized (#354): what a record keeps for it. */
  assigned(value: unknown): unknown {
    return this.normalize(this.cast(value));
  }

  /**
   * An already cast value through each of the attribute's normalizations, in order (#354): null
   * only through those declared `applyToNull`. Each result is cast again, so it's a value of the
   * attribute's type, whatever plain JavaScript returns; a promise is refused.
   */
  normalize(value: unknown): unknown {
    let normalized = value;
    for (const { with: normalize, applyToNull } of normalizationsOf(this.#model, this.name)) {
      if (normalized === null && !applyToNull) continue;
      const result = normalize(normalized);
      refuseThenable(
        result,
        `${this.#model.name} normalizes "${this.name}" with a function that returned a promise; a normalization runs synchronously`,
      );
      normalized = this.cast(result);
    }
    return normalized;
  }

  /**
   * A condition's value cast as a condition's, then normalized as an assigned value is (#354). A
   * value that can't be cast is kept as it was given, so it still matches nothing, and an error
   * that names it names what was given.
   */
  normalizedCondition(value: unknown): unknown {
    const cast = this.condition(value);
    return cast === noMatch ? value : this.normalize(cast);
  }

  /** Whether the attribute has a normalization, so its conditions need normalizing (#354). */
  get hasNormalization(): boolean {
    return normalizationsOf(this.#model, this.name).length > 0;
  }

  /** Whether it's an enum declared `validate: true`, which keeps an unknown value it's given. */
  #isValidatedEnum(): boolean {
    const { enum: values, validate = false } = this.#definition;
    return values !== undefined && validate !== false;
  }

  /**
   * A key copied from another record or inherited from a condition: cast as a condition's, but
   * one that can't be cast throws, naming the association it came through.
   */
  key(value: unknown, association?: string): unknown {
    requireDefined(this.#model, this.name, value);
    return this.#orRefuse(castKey(this.#definition, value), value, association);
  }

  /**
   * A condition's value (`where`, `find`, a preload) as the attribute's type, or `noMatch`: a
   * number also matches a string attribute as its digits, and a value that can't be cast
   * matches nothing, so a value from a URL is never an error.
   */
  condition(value: unknown): unknown {
    return castCondition(this.#definition, value);
  }

  /** A condition's value in the form D1 stores, or `noMatch`. */
  conditionCell(value: unknown): unknown {
    const cast = this.condition(value);
    return cast === noMatch ? noMatch : this.write(cast);
  }

  /**
   * An already cast value in the form D1 stores. A `json` value changed in place into one JSON
   * can't write throws `TypeError` naming the attribute, as assigning it would (#146).
   */
  write(value: unknown): unknown {
    let stored: unknown;
    try {
      stored = writeValue(this.#definition, value);
    } catch (error) {
      if (this.#definition.customType !== undefined) throw this.#refusal(value, undefined, error);
      if (this.#definition.type !== "json") throw error;
      throw this.#refusal(value);
    }
    // Only a json value gives nothing: JSON writes no function or symbol.
    if (stored === undefined) throw this.#refusal(value);
    return stored;
  }

  /** An assigned value cast, then in the form D1 stores. */
  store(value: unknown): unknown {
    return this.write(this.cast(value));
  }

  /** An assigned value cast and normalized (#354), then in the form D1 stores. */
  storeNormalized(value: unknown): unknown {
    return this.write(this.assigned(value));
  }

  /**
   * A cell D1 returned as the attribute's value. One that isn't (text in a Unix time column, or
   * past the range of a `Date`; a json cell that isn't JSON) throws `TypeError` naming the
   * attribute, with the cell hidden if it's filtered, not the parser's own error (#73, #146).
   */
  read(cell: unknown): unknown {
    const value = this.#convertOrRefuse(cell, () => readValue(this.#definition, cell));
    if (value === uncastable) throw this.#refusal(cell);
    return value;
  }

  /** A copy of a value: written as D1 stores it, then read back. */
  copy(value: unknown): unknown {
    return this.read(this.write(value));
  }

  /**
   * Whether two values are the same as stored (dates by time, json and bytes by content). Each is
   * cast as a condition's value first, so `isAttributeChanged`'s `from` and `to` compare as
   * conditions do, and one that can't be cast is the same as nothing (#20).
   */
  isSame(a: unknown, b: unknown): boolean {
    const [x, y] = [this.#comparable(a), this.#comparable(b)];
    if (x === noMatch || y === noMatch) return false;
    // Written as is, not through write, which refuses a validated enum's unknown value.
    return isSameCell(writeValue(this.#definition, x), writeValue(this.#definition, y));
  }

  /**
   * A value to compare, cast as a condition's: `null` stays `null`, and a validated enum's
   * unknown value, which a record may hold, stays as it is (#340).
   */
  #comparable(value: unknown): unknown {
    if (value === null || value === undefined) return value ?? null;
    const cast = this.condition(value);
    return cast === noMatch && this.#isValidatedEnum() ? value : cast;
  }

  /** An assigned value, cast and written, bound hidden from `onQuery` if filtered (#83). */
  bind(params: unknown[], value: unknown): void {
    this.bindCells(params, this.store(value));
  }

  /**
   * Binds cells (as D1 holds them) as the attribute's, each hidden from `onQuery` listeners when
   * the attribute is filtered (#83); D1 still gets the real values. Filtering is asked at the
   * time, since `filterAttributes` is a static a Model may set after this was resolved.
   */
  bindCells(params: unknown[], ...cells: unknown[]): void {
    const hidden = this.#isHidden();
    for (const cell of cells) params.push(hidden ? new Filtered(cell) : cell);
  }

  #orRefuse(cast: unknown, value: unknown, association?: string): unknown {
    if (cast === uncastable) throw this.#refusal(value, association);
    return cast;
  }

  /**
   * `convert`'s result. What a custom type's own function throws for `value` is refused as any
   * value its type can't hold, with the type's error as the cause (#20).
   */
  #convertOrRefuse(value: unknown, convert: () => unknown): unknown {
    try {
      return convert();
    } catch (error) {
      if (this.#definition.customType === undefined) throw error;
      throw this.#refusal(value, undefined, error);
    }
  }

  /** Whether the attribute's values are hidden from listeners and errors (#83). */
  #isHidden(): boolean {
    return isFiltered(this.#model, this.name);
  }

  /**
   * "Sample: "no" isn't a boolean for "enabled"", the value hidden for a filtered attribute. Also
   * what a stored value that can't be read says: a Unix time that isn't one (#73), or a json
   * cell that isn't JSON (#146). A custom type's own error is its cause, unless the attribute is
   * filtered: the error may show the value (#20).
   */
  #refusal(value: unknown, association?: string, cause?: unknown): TypeError {
    const hidden = this.#isHidden();
    const text = hidden ? FILTERED : shown(value);
    const from = association === undefined ? "" : `, the key of ${association}`;
    return new TypeError(
      `${this.#model.name}: ${text} isn't ${this.#described()} for "${this.name}"${from}`,
      hidden || cause === undefined ? undefined : { cause },
    );
  }

  /** What a value of the attribute is, as a refusal says it: `a boolean`, `one of "draft", "published"`. */
  #described(): string {
    const { type, enum: values, customType } = this.#definition;
    if (values !== undefined) return `one of ${listedNames(values)}`;
    if (customType !== undefined) return "a valid value";
    return valueNames[type] ?? withArticle(type);
  }
}

const resolved = new WeakMap<ModelClass, Map<string, Attribute>>();

/**
 * The resolved attribute of a Model, remembered per class (derived from the class, ADR-0003):
 * `UnknownAttribute` for a name it doesn't have.
 */
export function attributeFor(model: ModelClass, name: string): Attribute {
  let attributes = resolved.get(model);
  if (attributes === undefined) {
    attributes = new Map();
    resolved.set(model, attributes);
  }
  let attribute = attributes.get(name);
  if (attribute === undefined) {
    attribute = new Attribute(model, name);
    attributes.set(name, attribute);
  }
  return attribute;
}

/**
 * The values a record built from a Relation inherits from its conditions, cast as keys are: a
 * hasMany's foreign key names its association (`link`) when it can't be cast.
 */
export function castInherited(
  model: ModelClass,
  inherited: Record<string, unknown>,
  link?: { attribute: string; association: string },
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inherited).map(([attribute, value]) => {
      const association = attribute === link?.attribute ? link.association : undefined;
      return [attribute, attributeFor(model, attribute).key(value, association)];
    }),
  );
}

/** A word with `a` or `an` before it, as a message reads it: `an integer`, `a string`. */
export function withArticle(word: string): string {
  return `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`;
}

/** How much of a value an error shows: it came from outside, and errors are often logged. */
const SHOWN_LENGTH = 60;

/** What a value of an attribute type is called in a refusal, where `a`/`an` and its name isn't it. */
const valueNames: Partial<Record<AttributeType, string>> = {
  json: "a JSON value",
  binary: "binary data",
};

/** A value as an error shows it: JSON where it has one, numbers as written, and at most 60 characters. */
function shown(value: unknown): string {
  const text = textOf(value);
  return text.length > SHOWN_LENGTH ? `${text.slice(0, SHOWN_LENGTH)}…` : text;
}

function textOf(value: unknown): string {
  // Bytes by their kind and size: as JSON, a large array would cost far more than it shows (#20).
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `<${value.constructor.name} of ${value.byteLength} bytes>`;
  }
  if (value instanceof Blob) return `<${value.constructor.name} of ${value.size} bytes>`;
  if (typeof value === "number" || isInvalidDate(value)) return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return plainText(value);
  }
}

/** `String(value)`, or its tag (`[object Array]`) when it has no string form: building the refusal mustn't throw. */
function plainText(value: unknown): string {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
