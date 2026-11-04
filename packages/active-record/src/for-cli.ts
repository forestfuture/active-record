// What the `d1-record` command imports from the core (`@forestfuture/active-record/cli`), until it moves to the core (#278). Unstable.
export { ancestors } from "./ancestors.ts";
export { type EpochStorage, epochStorages } from "./epoch-storage.ts";
export { isBase } from "./generated-model.ts";
export { pluralize, singularize } from "./inflections.ts";
export { camelize, underscore } from "./naming.ts";
export { tableize } from "./table-names.ts";
