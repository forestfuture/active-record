// Turns a database's constraint failure into the matching `ConstraintViolation` for the written tables.
import type { Adapter, ConstraintFailure } from "./adapter.ts";
import {
  CheckViolation,
  ConstraintViolation,
  InvalidForeignKey,
  NotNullViolation,
  RecordNotUnique,
} from "./errors.ts";
import { attributesForColumn } from "./metadata.ts";
import type { ModelClass } from "./model.ts";

type ViolationClass = typeof ConstraintViolation;

/** Each kind's class, and a readable label, since bundlers may rename the error classes. */
const VIOLATIONS: Record<ConstraintFailure["kind"], readonly [ViolationClass, string]> = {
  unique: [RecordNotUnique, "not unique"],
  notNull: [NotNullViolation, "must not be null"],
  foreignKey: [InvalidForeignKey, "foreign key constraint failed"],
  check: [CheckViolation, "check constraint failed"],
};

/**
 * A constraint failure from a write to the tables of `models` (one statement's, or a batch's) as
 * the matching `ConstraintViolation`. Any other error is returned unchanged.
 */
export function translateConstraintError(
  adapter: Adapter,
  error: unknown,
  models: readonly ModelClass[],
): unknown {
  const failure = adapter.constraintFailure(error);
  return failure === undefined ? error : violation(failure, models, error);
}

/**
 * The Model a failure belongs to: the one whose table the error names, or, when it names
 * none, the only Model written to. Undefined when it names another table (a trigger's), or
 * when a batch writes to several.
 */
function failedModel(
  table: string | undefined,
  models: readonly ModelClass[],
): ModelClass | undefined {
  if (table !== undefined) return models.find((model) => model.table === table);
  return new Set(models).size === 1 ? models[0] : undefined;
}

/** `table` is the one the error names, or else the failed Model's; null if neither. */
function violation(
  { kind, table, columns }: ConstraintFailure,
  models: readonly ModelClass[],
  cause: unknown,
): ConstraintViolation {
  const [Kind, label] = VIOLATIONS[kind];
  const model = failedModel(table, models);
  const attributes =
    model === undefined ? [] : columns.flatMap((column) => attributesForColumn(model, column));
  const failedTable = table ?? model?.table ?? null;
  const named = columns.length > 0 ? ` (${columns.join(", ")})` : "";
  return new Kind(`${model?.name ?? failedTable ?? "batch"}${named}: ${label}`, {
    table: failedTable,
    columns,
    attributes,
    cause,
  });
}
