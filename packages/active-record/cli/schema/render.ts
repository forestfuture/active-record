// The generated `schema.ts` and `ApplicationRecord` files, and the schema's fingerprint.
import { stringLiteral } from "../source.ts";
import { createHash } from "node:crypto";
import type { Default, GeneratedTable, Spec } from "../adapter.ts";
import { isIdentifier } from "../project/names.ts";

/**
 * The generated file's format. Bump it when the output changes, so `--check` reports files an
 * older d1-record wrote (its fingerprint covers the format as well as the schema).
 */
const format = 5;

/**
 * An object key: bare when it's an identifier, quoted otherwise (`"first name"`). `__proto__` is
 * computed, since in an object literal a bare or quoted one sets the prototype and the key is
 * lost (#119).
 */
function keySource(name: string): string {
  if (name === "__proto__") return '["__proto__"]';
  return isIdentifier(name) ? name : JSON.stringify(name);
}

/** A JSON value as TypeScript source: `{ a: 1, tags: ["x"] }`. */
function valueSource(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(valueSource).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(
      ([key, each]) => `${keySource(key)}: ${valueSource(each)}`,
    );
    return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(value);
}

function defaultSource(value: Default): string {
  if ("date" in value) return `() => new Date(${JSON.stringify(value.date)})`;
  const source = valueSource(value.literal);
  return `() => ${source.startsWith("{") ? `(${source})` : source}`;
}

/** An attribute's spec: just its type when that's all it has, as Models are written by hand. */
function specSource(spec: Spec): string {
  const parts = [`type: ${JSON.stringify(spec.type)}`];
  if (spec.null === false) parts.push("null: false");
  if (spec.column !== undefined) parts.push(`column: ${JSON.stringify(spec.column)}`);
  if (spec.default !== undefined) parts.push(`default: ${defaultSource(spec.default)}`);
  if (spec.generateId) parts.push("generateId: true");
  return parts.length === 1 ? JSON.stringify(spec.type) : `{ ${parts.join(", ")} }`;
}

/** Text safe inside a `/** … *\/` comment. */
function commentText(text: string): string {
  return text.replaceAll("*/", "*\\/");
}

function tableSource(table: GeneratedTable): string {
  const attributes = Object.entries(table.attributes)
    .map(([name, spec]) => `  ${keySource(name)}: ${specSource(spec)},`)
    .join("\n");
  return `/** ${commentText(table.name)} — last changed by ${commentText(table.lastChangedBy)} */
export const ${table.exportName} = {
${attributes}
} as const;`;
}

/** A Model the schema lists: its class, its table, and its module as the schema imports it. */
export interface ListedModel {
  className: string;
  table: string;
  module: string;
}

/** What a database's generated schema is made of: its tables, its binding, and its Models. */
export interface SchemaSource {
  tables: readonly GeneratedTable[];
  binding: string;
  models: readonly ListedModel[];
}

/** A short hash of the schema itself, so `--check` ignores how the file is formatted. */
export function fingerprintOf({ tables, binding, models }: SchemaSource): string {
  // In the order the file lists them, whichever order they were found in.
  const listed = byName(models, (model) => model.className);
  const hash = createHash("sha256").update(
    JSON.stringify({ format, tables, binding, models: listed }),
  );
  return hash.digest("hex").slice(0, 12);
}

/** Items sorted by a name, as `localeCompare` doesn't: the same on every machine. */
function byName<T>(items: readonly T[], name: (item: T) => string): T[] {
  return [...items].sort((a, b) => (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0));
}

/** The Models' entries as an object: on one line, or one a line when that would be too long. */
function modelsSource(entries: readonly string[]): string {
  const line = entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
  if (`  models: ${line},`.length <= 100) return line;
  return `{\n${entries.map((entry) => `    ${entry},`).join("\n")}\n  }`;
}

/** The `schema` value: its adapter and binding, every table by name, and every Model's table by class. */
function schemaValueSource({ tables, binding, models }: SchemaSource): string {
  const entries = tables
    .map((table) => {
      const primaryKey = JSON.stringify(table.primaryKey);
      return `    ${keySource(table.name)}: { attributes: ${table.exportName}, primaryKey: ${primaryKey} },`;
    })
    .join("\n");
  const listed = byName(models, (model) => model.className).map(
    (model) => `${keySource(model.className)}: ${JSON.stringify(model.table)}`,
  );
  return `/** The database's adapter and binding, its tables (with their primary keys), and the Models built on them. */
export const schema = {
  adapter: d1({ binding: ${stringLiteral(binding)} }),
  tables: {
${entries}
  },
  models: ${modelsSource(listed)},
} as const;`;
}

/** A Model's declaration: its class, with its table's attributes after its own overrides. */
function interfaceSource(model: ListedModel, exportName: string): string {
  const name = model.className;
  const heritage = `extends TableAttributes<typeof ${exportName}, (typeof ${name})["attributes"]> {}`;
  const line = `  interface ${name} ${heritage}`;
  return line.length <= 100 ? line : `  interface ${name}\n    ${heritage}`;
}

/** One `declare module` block per Model file, adding each class's attributes to it. */
function declarationsSource({ tables, models }: SchemaSource): string {
  const exportNames = new Map(tables.map((table) => [table.name, table.exportName]));
  const modules = new Map<string, ListedModel[]>();
  for (const model of byName(models, (each) => each.className)) {
    modules.set(model.module, [...(modules.get(model.module) ?? []), model]);
  }
  return byName([...modules], ([module]) => module)
    .map(([module, inModule]) => {
      const lines = inModule.map((model) => interfaceSource(model, exportNames.get(model.table)!));
      return `declare module ${stringLiteral(module)} {\n${lines.join("\n")}\n}`;
    })
    .join("\n\n");
}

/**
 * The generated `schema.ts`: each table's attributes, the binding with every table and Model,
 * and each Model's attributes added to its class. It's the schema as a document, like Rails'
 * `schema.rb`; the app's base class (`renderBase`) holds it.
 */
export function renderSchema(schema: SchemaSource, source: string): string {
  const hasModels = schema.models.length > 0;
  const imports =
    (hasModels ? 'import type { TableAttributes } from "@forestfuture/active-record";\n' : "") +
    'import { d1 } from "@forestfuture/d1-record";\n\n';
  const declarations = hasModels ? `\n\n${declarationsSource(schema)}` : "";
  return `// Generated by \`active-record schema\` from ${source} — don't edit.
// schema: ${fingerprintOf(schema)}

${imports}${schema.tables.map(tableSource).join("\n\n")}

${schemaValueSource(schema)}${declarations}
`;
}

/**
 * The app's base class for a database's Models, written once and then the app's own, as Rails'
 * `ApplicationRecord` is: `class Product extends ApplicationRecord {}`.
 */
export function renderBase(className: string, schemaImport: string): string {
  return `import { Model } from "@forestfuture/active-record";
import { schema } from ${stringLiteral(schemaImport)};

/**
 * The base class for this app's Models: \`class Product extends ${className} {}\`. Methods,
 * callbacks and scopes written here are shared by every Model, as in Rails' ApplicationRecord.
 * It's abstract: it has no table of its own.
 */
export abstract class ${className} extends Model {
  // The generated schema: each Model's attributes, from its table, and the D1 binding Models
  // query (Product.find(id)), from your Wrangler config's d1_databases.
  static override schema = schema;

  // A method every record has:
  // label() {
  //   return \`\${this.constructor.name} \${JSON.stringify(this.attributes())}\`;
  // }

  // A scope every Model has, in SQL since it runs on each Model's own table (import sql too):
  // static newest = this.scope((q) => q.order(sql\`created_at DESC\`));

  // Log every query, from every Model, in production too (import type QueryListener too; the
  // guide's Connecting page shows development-only logging, and one request's queries):
  // static override onQuery: QueryListener = ({ model, sql, durationMs }) =>
  //   console.log(\`\${model} \${durationMs.toFixed(1)}ms \${sql}\`);

  // Values of attributes named like these show as "[FILTERED]" to onQuery and in errors. These
  // are Rails' defaults (passwords, tokens, keys, emails…); add yours, or leave one out:
  // static override filterAttributes = [...Model.filterAttributes, "iban"];

  // Attributes toJSON() leaves out, so Response.json(record) never sends them (exact names;
  // attributes() still has them):
  // static override hiddenAttributes = ["passwordDigest"];

  // How new TEXT keys are made (a UUID by default), e.g. time-ordered ones from a
  // library you choose:
  // static override generateId = () => uuidv7();

  static {
    // A callback that runs for every Model, before each Model's own:
    // this.beforeSave((record) => {
    //   console.log(\`Saving \${record.constructor.name}\`);
    // });
    // Error messages in place of the built-in English, for every Model (a Model can declare
    // its own, and attributes: { email: { … } } is for one attribute):
    // this.errorMessages({ blank: "is required" });
  }
}
`;
}

/** The fingerprint a generated file was made from, read from its header. */
export function fingerprintIn(source: string): string | undefined {
  return /^\/\/ schema: ([0-9a-f]{12})$/m.exec(source)?.[1];
}
