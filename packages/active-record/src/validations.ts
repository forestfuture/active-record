// Validators (`presence`, `length`, `uniqueness`, …) and running them on a record.
import {
  comparisonFailures,
  orderOf,
  RANGE_CHECKS,
  type ComparisonOptions,
} from "./comparison-validation.ts";
import { isBlank } from "./blank.ts";
import { orderDecimal } from "./decimal-values.ts";
import { addFailure, fullMessageOf, type Errors, type Failure } from "./errors-collection.ts";
import { StrictValidationFailed } from "./errors.ts";
import { attributeOf } from "./metadata.ts";
import { isInContext, type ValidationContexts } from "./validation-context.ts";
import type { AttributesOf } from "./model.ts";

export interface LengthOptions {
  minimum?: number;
  maximum?: number;
  is?: number;
}

export interface NumericalityOptions {
  onlyInteger?: boolean;
  greaterThan?: number;
  greaterThanOrEqualTo?: number;
  lessThan?: number;
  lessThanOrEqualTo?: number;
}

/** The values `inclusion` and `exclusion` list: an array, or `{ in: [...] }`. */
type ValueList = readonly unknown[] | { in: readonly unknown[] };

/** The Model's attribute names for record type `R` (any string where `R` isn't known). */
type AttributeName<R> = [R] extends [never] ? string : keyof AttributesOf<R> & string;

export interface UniquenessOptions<R = never> {
  /** Attributes that must also match for a value to count as taken. */
  scope?: readonly AttributeName<R>[];
  caseSensitive?: boolean;
}

/** The rules for one `validates(attribute, options)` call. `R` is the Model's record type. */
export interface ValidationOptions<R = never> {
  /** Not null, and not blank after trimming a string. */
  presence?: boolean;
  /** Null, or blank after trimming a string: what `presence` fails ("must be blank"). */
  absence?: boolean;
  length?: LengthOptions;
  format?: RegExp | { with: RegExp };
  inclusion?: ValueList;
  /** Not one of these values ("is reserved"); null passes unless the list holds it. */
  exclusion?: ValueList;
  numericality?: boolean | NumericalityOptions;
  /**
   * Bounds the value must meet: numbers, strings (in JavaScript's order) or Dates (by time).
   */
  comparison?: ComparisonOptions<R>;
  /**
   * The value is one of `accept` (`true` and `"1"` unless given): a box that must be ticked.
   * Null fails, since an unticked checkbox sends nothing; `allowNull: true` lets it pass.
   */
  acceptance?: boolean | { accept: readonly unknown[] };
  /**
   * No other row has this value (checked in D1 through the record's Database). `scope` adds
   * attributes that must match too; `caseSensitive: false` compares with `lower()` (ASCII only).
   * `null` is never taken, as with SQLite's UNIQUE. Not race-safe: the constraint has the final say.
   */
  uniqueness?: boolean | UniquenessOptions<R>;
  /** Skip these rules when the value is null. */
  allowNull?: boolean;
  /** Skip these rules when the value is blank: null, or a string that's only whitespace. */
  allowBlank?: boolean;
  /** Replaces the default message of every failure from these rules. */
  message?: string;
  /**
   * Throw `StrictValidationFailed` with a failure's full message instead of adding it to
   * `errors`: for a value only a bug in the app's own code could give. An Error class is thrown
   * in its place, made with the same message.
   */
  strict?: true | (new (message: string) => Error);
  /** Only run these rules when this returns true. */
  if?: (record: R) => boolean;
  /** Skip these rules when this returns true; with `if`, both must allow them. */
  unless?: (record: R) => boolean;
  /**
   * Only run these rules in this validation context, or these: `"create"` while the record is
   * new, `"update"` once it's saved, or a name given to `isValid` or `save`.
   */
  on?: ValidationContexts;
  /** Skip these rules in this validation context, or these, and run them in any other. */
  exceptOn?: ValidationContexts;
}

/** The options of a `validatesAssociated(association, options)` call. */
export type AssociatedValidationOptions<R = never> = Pick<
  ValidationOptions<R>,
  "message" | "strict" | "if" | "unless"
>;

/**
 * One `validates(attribute, options)` declaration, or a `validatesAssociated(association,
 * options)` one, which names an association.
 */
export interface Validation {
  attribute: string;
  options: ValidationOptions<never>;
  associated?: true;
}

/** @internal The record being validated, and the attribute a check reads. */
export interface ValidationSubject {
  record: object;
  attribute: string;
  /** The values of the record's loaded filtered attributes, which messages mustn't show. */
  filteredValues: () => unknown[];
  /** Whether the attribute is a built-in decimal, which holds a number as text (#391). */
  isDecimal: boolean;
}

type Check = (
  value: unknown,
  options: ValidationOptions<never>,
  subject: ValidationSubject,
) => Failure[];

const presence: Check = (value, { presence: required }) =>
  required && isBlank(value) ? [{ type: "blank" }] : [];

const absence: Check = (value, { absence: required }) =>
  required && !isBlank(value) ? [{ type: "present" }] : [];

const length: Check = (value, { length: rule }) => {
  if (rule === undefined) return [];
  // A string's characters or an array's items (e.g. a json list); anything else has length 0.
  const size = typeof value === "string" || Array.isArray(value) ? value.length : 0;
  const failures: Failure[] = [];
  if (rule.is !== undefined && size !== rule.is) {
    failures.push({ type: "wrongLength", values: { count: rule.is } });
  }
  if (rule.minimum !== undefined && size < rule.minimum) {
    failures.push({ type: "tooShort", values: { count: rule.minimum } });
  }
  if (rule.maximum !== undefined && size > rule.maximum) {
    failures.push({ type: "tooLong", values: { count: rule.maximum } });
  }
  return failures;
};

const format: Check = (value, { format: rule }) => {
  if (rule === undefined) return [];
  const pattern = rule instanceof RegExp ? rule : rule.with;
  // search() always starts at 0 and ignores the pattern's lastIndex, unlike test() with /g or /y.
  const matches = typeof value === "string" && value.search(pattern) !== -1;
  return matches ? [] : [{ type: "invalid" }];
};

/** Equality for inclusion: dates match by their time, everything else by identity. */
function isSameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return Object.is(a, b);
}

/** Whether `value` is in a list given as an array or as `{ in: [...] }`. */
function isListed(list: ValueList, value: unknown): boolean {
  const items = Array.isArray(list) ? list : (list as { in: readonly unknown[] }).in;
  return items.some((item) => isSameValue(item, value));
}

const inclusion: Check = (value, { inclusion: rule }) =>
  rule === undefined || isListed(rule, value) ? [] : [{ type: "inclusion" }];

const exclusion: Check = (value, { exclusion: rule }) =>
  rule !== undefined && isListed(rule, value) ? [{ type: "exclusion" }] : [];

/** A value `numericality` checks: whether it's whole, and where it falls against a bound. */
interface Numeric {
  isInteger: boolean;
  orderTo: (bound: number) => number;
}

/**
 * A number, or a decimal attribute's text (#391), compared exactly with a bound as a decimal; any
 * other value, a numeric string included, is undefined: not a number.
 */
function numericOf(value: unknown, { isDecimal }: ValidationSubject): Numeric | undefined {
  if (isDecimal && typeof value === "string") {
    // A finite number is always a decimal, so a bound orders as a number or as NaN.
    return { isInteger: !value.includes("."), orderTo: (bound) => orderDecimal(value, bound)! };
  }
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return { isInteger: Number.isInteger(value), orderTo: (bound) => orderOf(value, bound) };
}

/** Only numbers pass, and a decimal's text; a numeric string like "12" is not a number. */
const numericality: Check = (value, { numericality: rule }, subject) => {
  if (rule === undefined || rule === false) return [];
  const numeric = numericOf(value, subject);
  if (numeric === undefined) return [{ type: "notANumber" }];
  const options = rule === true ? {} : rule;
  if (options.onlyInteger && !numeric.isInteger) {
    return [{ type: "notAnInteger" }];
  }
  return RANGE_CHECKS.flatMap(([type, holds]) => {
    const bound = options[type];
    return bound === undefined || holds(numeric.orderTo(bound))
      ? []
      : [{ type, values: { count: bound } }];
  });
};

const comparison: Check = (value, { comparison: rule }, subject) =>
  rule === undefined ? [] : comparisonFailures(value, rule as ComparisonOptions<unknown>, subject);

const DEFAULT_ACCEPTED = [true, "1"];

const acceptance: Check = (value, { acceptance: rule }) => {
  if (rule === undefined || rule === false) return [];
  const accepted = rule === true ? DEFAULT_ACCEPTED : rule.accept;
  return isListed(accepted, value) ? [] : [{ type: "accepted" }];
};

/** Applied in this order within one `validates` call. */
const CHECKS: readonly Check[] = [
  presence,
  absence,
  length,
  format,
  inclusion,
  exclusion,
  numericality,
  comparison,
  acceptance,
];

/** What running validations needs from the record being validated. */
export interface ValidationTarget {
  record: object;
  /** The values of the record's loaded filtered attributes. */
  filteredValues: () => unknown[];
  read: (attribute: string) => unknown;
  errors: Errors;
  /** Whether another row already has `value` for `attribute` (the uniqueness check, in D1). */
  isTaken: (attribute: string, value: unknown, options: UniquenessOptions) => Promise<boolean>;
  /** Whether every record of the association, loaded first if it isn't, is valid. */
  isAssociationValid: (association: string) => Promise<boolean>;
  /** The validation contexts the record is validated in (#51). */
  contexts: readonly string[];
}

async function uniquenessFailures(
  target: ValidationTarget,
  attribute: string,
  value: unknown,
  { uniqueness: rule }: ValidationOptions<never>,
): Promise<Failure[]> {
  if (rule === undefined || rule === false || value === null) return [];
  const taken = await target.isTaken(attribute, value, rule === true ? {} : rule);
  return taken ? [{ type: "taken" }] : [];
}

/** Runs every validation in declaration order, adding failures to `errors`. */
export async function runValidations(
  validations: readonly Validation[],
  target: ValidationTarget,
): Promise<void> {
  for (const validation of validations) {
    const { attribute, options } = validation;
    if (!isApplied(target, options)) continue;
    for (const failure of await failuresOf(validation, target)) {
      const added = { ...failure, message: options.message };
      if (options.strict) throw strictFailure(target, attribute, added, options.strict);
      target.errors[addFailure](attribute, added);
    }
  }
}

/** A validation's failures: its rules' for the attribute's value, or "invalid" for an association. */
async function failuresOf(
  { attribute, options, associated }: Validation,
  target: ValidationTarget,
): Promise<Failure[]> {
  if (associated) {
    return (await target.isAssociationValid(attribute)) ? [] : [{ type: "invalid" }];
  }
  const value = target.read(attribute);
  if (isAllowed(value, options)) return [];
  const subject = {
    record: target.record,
    attribute,
    filteredValues: target.filteredValues,
    isDecimal: isBuiltInDecimal(target.record, attribute),
  };
  return [
    ...CHECKS.flatMap((check) => check(value, options, subject)),
    ...(await uniquenessFailures(target, attribute, value, options)),
  ];
}

/** Whether a validation's `on`, `if` and `unless` let its rules run on the target's record. */
function isApplied(
  { record, contexts }: ValidationTarget,
  options: ValidationOptions<never>,
): boolean {
  if (!isInContext(contexts, options)) return false;
  if (options.if && !options.if(record as never)) return false;
  return !options.unless?.(record as never);
}

/** The error a `strict: true` rule throws for its failure. */
function strictFailure(
  { errors }: ValidationTarget,
  attribute: string,
  failure: Failure,
  strict: true | (new (message: string) => Error),
): Error {
  const ErrorClass = strict === true ? StrictValidationFailed : strict;
  return new ErrorClass(errors[fullMessageOf](attribute, failure));
}

/** Whether `allowNull` or `allowBlank` skips the rules for this value. */
function isAllowed(value: unknown, { allowNull, allowBlank }: ValidationOptions<never>): boolean {
  return (allowNull === true && value === null) || (allowBlank === true && isBlank(value));
}

/** Whether a record's attribute is a decimal of the built-in type, not a custom type stored as one. */
function isBuiltInDecimal(record: object, attribute: string): boolean {
  const { type, customType } = attributeOf(record.constructor as never, attribute);
  return type === "decimal" && customType === undefined;
}

/** The attributes a validation names (its own, and a uniqueness `scope`'s) must be the Model's. */
export function checkValidatedNames(
  model: Parameters<typeof attributeOf>[0],
  { attribute, options, associated }: Validation,
): void {
  // `validatesAssociated`'s names are checked once the Model's associations are known.
  if (associated) return;
  attributeOf(model, attribute);
  const { uniqueness } = options;
  if (typeof uniqueness === "object") {
    for (const name of uniqueness.scope ?? []) attributeOf(model, name);
  }
}
