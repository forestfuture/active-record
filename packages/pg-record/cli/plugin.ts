// The Postgres adapter's plugin for the `active-record` command (`@forestfuture/pg-record/cli`, #285).
import type { CliAdapter } from "@forestfuture/active-record/cli";
import { readDatabases } from "./config.ts";
import { schemaOf } from "./schema.ts";

const notYet = (): never => {
  throw new Error("Not built yet (#285)");
};

/** Postgres, as the command line sees it: `active-record.jsonc`'s databases, PGlite's schema, and `pg`. */
export const cli: CliAdapter = {
  name: "pg",
  databases: readDatabases,
  readSchema: schemaOf,
  migration: notYet,
  remote: notYet,
  stateFolder: notYet,
  open: notYet,
  migrate: notYet,
};
