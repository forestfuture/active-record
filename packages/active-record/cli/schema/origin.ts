// Notes for a schema from another tool's migrations, and for migrations in folders the config doesn't find.
// Those tools can store values differently from active-record's conventions, so some columns
// convert to the wrong type and fail when they are read (#73, #159).
import { underscore } from "../../src/naming.ts";
import { storageOverride } from "./storage-override.ts";
import { shown } from "../project/paths.ts";
import type { Target } from "../project/targets.ts";
import type { Tool } from "../project/tools.ts";
import type { GeneratedTable } from "../adapter.ts";

const issue = "https://github.com/forestfuture/active-record/issues/73";

/** Column names (as snake_case words) that suggest a `TEXT` column holds JSON. */
const jsonish = /(^|_)(json|metadata|settings|payload|properties)$/;

/**
 * The hint for migrations in folders, when `hasNestedMigrations` found them: the pattern to set,
 * when the adapter reads one (`setting`), or that they aren't read.
 */
export function layoutNote(cwd: string, target: Target, setting: string | undefined): string {
  const dir = target.migrationsDir;
  const found = `${shown(cwd, dir)}/ has its migrations in folders, as Drizzle writes them`;
  if (setting === undefined) return `${found}, which aren't read`;
  const pattern = `${shown(target.configDir, dir)}/*/migration.sql`;
  const config = shown(cwd, target.configFile);
  return `${found}; set ${setting} to "${pattern}" in ${config}, so they're read`;
}

/** The columns worth checking, in a schema from `tool`'s migrations. */
function columnNotes(tool: Tool, tables: readonly GeneratedTable[]): string[] {
  const notes: string[] = [];
  for (const table of tables) {
    for (const [attribute, spec] of Object.entries(table.attributes)) {
      const column = spec.column ?? underscore(attribute);
      // Drizzle names columns after their TypeScript keys by default (createdAt), so compare words.
      const words = underscore(column);
      const where = `${table.name}.${column}`;
      if (spec.type === "integer" && words.endsWith("_at")) {
        notes.push(
          `${where}: read as an integer; if it holds a Unix timestamp, override it in its Model as ` +
            storageOverride(tool === "Drizzle"),
        );
      } else if (spec.type === "string" && jsonish.test(words)) {
        notes.push(
          `${where}: read as a string; if it holds JSON, override it as "json" in its Model`,
        );
      }
    }
  }
  return notes;
}

/** A note for a datetime whose default writes SQLite's date text, which sorts apart from ISO (#143). */
function textDateNote(where: string): string {
  return (
    `${where}: its default writes SQLite's date text (2026-10-12 06:38:30), where d1-record ` +
    `writes ISO text (2026-10-12T06:38:30.000Z), and the two sort apart as text, so range ` +
    `conditions can misplace values within a day (see Existing databases in the guide)`
  );
}

/**
 * Notes for a schema generated from another tool's migrations: the tool, then the columns to
 * check, and `textDates`, the datetime columns whose default is SQLite's own date text.
 */
export function originNotes(
  tool: Tool | undefined,
  tables: readonly GeneratedTable[],
  textDates: readonly string[],
): string[] {
  if (tool === undefined) return [];
  return [
    `these migrations look like ${tool}'s. Some columns may convert to the wrong type and fail ` +
      `when read, especially numeric timestamps: check the generated types (${issue})`,
    ...columnNotes(tool, tables),
    ...textDates.map(textDateNote),
  ];
}
