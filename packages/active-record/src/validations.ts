// Validators (`presence`, `length`, `uniqueness`, …) and running them on a record.
import { addFailure, type Errors, type Failure } from "./errors-collection.ts";
import { attributeOf } from "./metadata.ts";
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
  length?: LengthOptions;
  format?: RegExp | { with: RegExp };
  inclusion?: readonly unknown[] | { in: readonly unknown[] };
  numericality?: boolean | NumericalityOptions;
  /**
   * No other row has this value (checked in D1 through the record's Database). `scope` adds
   * attributes that must match too; `caseSensitive: false` compares with `lower()` (ASCII only).
   * `null` is never taken, as with SQLite's UNIQUE. Not race-safe: the constraint has the final say.
   */
  uniqueness?: boolean | UniquenessOptions<R>;
  /** Skip these rules when the value is null. */
  allowNull?: boolean;
  /** Replaces the default message of every failure from these rules. */
  message?: string;
  /** Only run these rules when this returns true. */
  if?: (record: R) => boolean;
}

/** One `validates(attribute, options)` declaration. */
export interface Validation {
  attribute: string;
  options: ValidationOptions<never>;
}

type Check = (value: unknown, options: ValidationOptions<never>) => Failure[];

function isBlank(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

const presence: Check = (value, { presence: required }) =>
  required && isBlank(value) ? [{ type: "blank" }] : [];

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
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return Object.is(a, b);
}

const inclusion: Check = (value, { inclusion: rule }) => {
  if (rule === undefined) return [];
  const allowed = Array.isArray(rule) ? rule : (rule as { in: readonly unknown[] }).in;
  const included = allowed.some((item) => sameValue(item, value));
  return included ? [] : [{ type: "inclusion" }];
};

const COMPARISONS = [
  ["greaterThan", (a: number, b: number) => a > b],
  ["greaterThanOrEqualTo", (a: number, b: number) => a >= b],
  ["lessThan", (a: number, b: number) => a < b],
  ["lessThanOrEqualTo", (a: number, b: number) => a <= b],
] as const;

/** Only real numbers pass; a numeric string like "12" is not a number (convert input first). */
const numericality: Check = (value, { numericality: rule }) => {
  if (rule === undefined || rule === false) return [];
  if (typeof value !== "number" || Number.isNaN(value)) {
    return [{ type: "notANumber" }];
  }
  const options = rule === true ? {} : rule;
  if (options.onlyInteger && !Number.isInteger(value)) {
    return [{ type: "notAnInteger" }];
  }
  return COMPARISONS.flatMap(([type, holds]) => {
    const bound = options[type];
    return bound === undefined || holds(value, bound) ? [] : [{ type, values: { count: bound } }];
  });
};

/** Applied in this order within one `validates` call. */
const CHECKS: readonly Check[] = [presence, length, format, inclusion, numericality];

/** What running validations needs from the record being validated. */
export interface ValidationTarget {
  record: unknown;
  read: (attribute: string) => unknown;
  errors: Errors;
  /** Whether another row already has `value` for `attribute` (the uniqueness check, in D1). */
  isTaken: (attribute: string, value: unknown, options: UniquenessOptions) => Promise<boolean>;
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
  for (const { attribute, options } of validations) {
    if (options.if && !options.if(target.record as never)) continue;
    const value = target.read(attribute);
    if (options.allowNull && value === null) continue;
    const failures = [
      ...CHECKS.flatMap((check) => check(value, options)),
      ...(await uniquenessFailures(target, attribute, value, options)),
    ];
    for (const failure of failures) {
      target.errors[addFailure](attribute, { ...failure, message: options.message });
    }
  }
}

/** The attributes a validation names (its own, and a uniqueness `scope`'s) must be the Model's. */
export function checkValidatedNames(
  model: Parameters<typeof attributeOf>[0],
  { attribute, options }: Validation,
): void {
  attributeOf(model, attribute);
  const { uniqueness } = options;
  if (typeof uniqueness === "object") {
    for (const name of uniqueness.scope ?? []) attributeOf(model, name);
  }
}
