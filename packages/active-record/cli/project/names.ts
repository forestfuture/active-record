// Attribute, export, class and module names for generated code.
import { camelize, underscore } from "../../src/naming.ts";

/** Whether a name can be written bare: as a `const`, or as an object key without quotes. */
export function isIdentifier(name: string): boolean {
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name);
}

/** A column's attribute: camelCase, keeping any leading underscores (`_secret` stays). */
export function attributeName(column: string): string {
  const lead = /^_*/.exec(column)![0];
  return lead + camelize(column.slice(lead.length));
}

/** Words JavaScript doesn't allow as a `const` name, and the generated file's own names. */
const reserved = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends " +
    "false finally for function if import in instanceof new null return super switch this throw " +
    "true try typeof var void while with yield let static implements interface package private " +
    "protected public await arguments eval tables"
  ).split(" "),
);

/**
 * The `const` a table is exported as: its words in camelCase (`line_items` → `lineItems`),
 * never a reserved word (`default` → `defaultTable`) or starting with a digit (`2fa` →
 * `table2fa`).
 */
export function exportName(table: string): string {
  const words = table.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const name = words
    .map((word, index) => (index === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join("");
  if (name === "" || /^\p{N}/u.test(name)) return `table${name}`;
  return reserved.has(name) ? `${name}Table` : name;
}

/** A class name from any spelling: `line_item`, `lineItem` → `LineItem`. */
export function classify(name: string): string {
  const camel = camelize(underscore(name));
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** A Model's module, in kebab-case: `LineItem` → `line-item` (its file is `line-item.ts`). */
export function moduleName(className: string): string {
  return underscore(className).replaceAll("_", "-");
}

/** `"A"`, `"A or B"`, `"A, B or C"`. */
export function listed(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}
