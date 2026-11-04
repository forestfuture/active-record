import { Model } from "../../packages/active-record/src/index.ts";

// One attribute of every type and storage, shared by the property tests that try values of any
// shape against them (assigned: casting-properties; stored: reading-properties and
// stored-datetime-properties; conversions: type-for-attribute-properties).
export const declared = {
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
  settings: "json",
} as const;

export class Sample extends Model.define({ id: { type: "integer", null: false }, ...declared }) {
  static table = "samples";
}

export type SampleAttribute = keyof typeof declared;
export const sampleAttributes = Object.keys(declared) as SampleAttribute[];

/** The attribute's declared type, whatever its storage. */
function typeOf(attribute: SampleAttribute): string {
  const spec = declared[attribute];
  return typeof spec === "string" ? spec : spec.type;
}

/** What an error calls a value of the attribute's type: `an integer`, `a datetime`. */
const noun = (attribute: SampleAttribute): string =>
  typeOf(attribute) === "json" ? "JSON value" : typeOf(attribute);

/** The refusal of a value that isn't the attribute's type, for assigned values and cells alike. */
const notOfType = (attribute: SampleAttribute): string =>
  `.* isn't an? ${noun(attribute)} for "${attribute}"`;

/** A refused assignment: a value that isn't the type, or `undefined` (which isn't NULL). */
export function assignedRefusal(attribute: SampleAttribute): RegExp {
  const missing = `got undefined for "${attribute}"; use null to store NULL`;
  return new RegExp(`^Sample: (?:${notOfType(attribute)}|${missing})$`, "s");
}

/** A refused stored cell. */
export const readRefusal = (attribute: SampleAttribute): RegExp =>
  new RegExp(`^Sample: ${notOfType(attribute)}$`, "s");

/** Whether `value` is a JavaScript value of the attribute's declared type. */
export function isOfType(attribute: SampleAttribute, value: unknown): boolean {
  switch (typeOf(attribute)) {
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isSafeInteger(value);
    case "real":
      return Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "datetime":
      return value instanceof Date && !Number.isNaN(value.getTime());
    case "json":
      // The definition, not an independent check: a json value is what JSON can write (#146).
      // What a property tests is that nothing else gets through, and that the refusal is a
      // TypeError naming the attribute.
      try {
        return JSON.stringify(value) !== undefined;
      } catch {
        return false;
      }
    default:
      throw new Error(`no type check for ${typeOf(attribute)}`);
  }
}

/** The result of `run`, or the error it threw. */
export function attempt<T>(run: () => T): { ok: true; value: T } | { ok: false; error: Error } {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
