// What an adapter's command line plugin imports from the core (`@forestfuture/active-record/cli`): the plugin's interface and the helpers its readers share. Unstable, as `/adapter` is.
export type * from "./adapter.ts";
export type { ColumnArg } from "./generate/columns.ts";
export { indexName, migrationPlan, type MigrationPlan } from "./generate/migration-plan.ts";
export { byName, type Migration } from "./project/migrations.ts";
export {
  configFileName,
  parseJsonc,
  readProjectConfig,
  type ProjectConfig,
} from "./project/config-file.ts";
export { attributeName, exportName, listed } from "./project/names.ts";
export { storageOverride } from "./schema/storage-override.ts";
export {
  generatedSchema,
  type Converted,
  type Reading,
  type ReadColumn,
  type ReadTable,
} from "./schema/tables.ts";
export { pluralize } from "../src/inflections.ts";
export { underscore } from "../src/naming.ts";
