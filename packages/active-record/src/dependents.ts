// What destroying a record does to its `dependent` associations, planned before the DELETE.
import { associationsOf } from "./association-fields.ts";
import type { CompiledSql } from "./compiler.ts";
import { DeleteRestriction } from "./errors.ts";
import { addFailure } from "./errors-collection.ts";
import { humanAttributeName } from "./error-messages.ts";
import { prepareDestroy, refusalError, type Claimed } from "./lifecycle.ts";
import { modelOf, type Model } from "./model.ts";
import { state } from "./record-state.ts";
import type { Scoped } from "./relation.ts";
import { statementParts, type Statement } from "./statement.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";
import { statementWrite, type PreparedWrite } from "./unit-of-work.ts";

/**
 * What an owner's `dependent:` associations add to its destroy (built when its batch is), or
 * why they refuse it.
 */
export type DependentsPlan =
  | { status: "ready"; writes: () => PreparedWrite[] }
  | { status: "restricted"; reason: string };

/**
 * Prepares the owner's `dependent:` strategies, in the contract's order: restrictions first, so
 * a restricted owner touches nothing; then each `destroy` record's own prepared destroy (its
 * callbacks and dependents); then the `deleteAll`/`delete`/`nullify` statements. The caller
 * writes all of it in one batch with the owner's DELETE.
 */
export async function prepareDependents(owner: Model, claimed: Claimed): Promise<DependentsPlan> {
  const model = modelOf(owner);
  const dependencies = [...associationsOf(model)]
    .filter(([, definition]) => definition.dependent !== undefined)
    .map(([name]) => resolveAssociation(model, name));
  for (const association of dependencies) {
    const reason = await checkRestriction(owner, association);
    if (reason !== undefined) return { status: "restricted", reason };
  }
  const stages: (() => PreparedWrite[])[] = [];
  for (const association of dependencies) {
    stages.push(...(await destroyRecords(owner, association, claimed)));
  }
  const statements = dependencies.flatMap((association) => statementFor(owner, association));
  return {
    status: "ready",
    writes: () => [...stages.flatMap((stage) => stage()), statementWrite(statements)],
  };
}

/** The association's records for this owner (a hasOne's first one only), with its scope. */
function recordsOf(owner: Model, association: ResolvedAssociation): Scoped<Model> {
  const records = association.linkedTo(owner[state].executor, association.keyOf(owner));
  return association.definition.kind === "hasOne" ? association.inOrder(records).limit(1) : records;
}

/** Why a restrict strategy refuses the destroy, if it does (Rails' wording). */
async function checkRestriction(
  owner: Model,
  association: ResolvedAssociation,
): Promise<string | undefined> {
  const { name, definition } = association;
  const { dependent, kind } = definition;
  if (dependent !== "restrictWithException" && dependent !== "restrictWithError") return undefined;
  if (!(await recordsOf(owner, association).exists())) return undefined;
  if (dependent === "restrictWithException") {
    throw new DeleteRestriction(`Cannot delete record because of dependent ${name}`);
  }
  // The association by its human name, in lowercase, as Rails' %{record}.
  const record = humanAttributeName(modelOf(owner), name).toLowerCase();
  return owner.errors[addFailure]("base", {
    type: "restrictDependentDestroy",
    values: { record },
    form: kind === "hasOne" ? "hasOne" : "hasMany",
  });
}

/**
 * `destroy`: each record's prepared destroy, callbacks and dependents included. A record that
 * refuses stops the owner's destroy before anything is written.
 */
async function destroyRecords(
  owner: Model,
  association: ResolvedAssociation,
  claimed: Claimed,
): Promise<(() => PreparedWrite[])[]> {
  if (association.definition.dependent !== "destroy") return [];
  const stages: (() => PreparedWrite[])[] = [];
  for (const record of await recordsOf(owner, association).toArray()) {
    const plan = await prepareDestroy(record, claimed);
    if (plan.status !== "ready") throw refusalError(record, plan, "destroy");
    stages.push(...plan.stages);
  }
  return stages;
}

/** The statement for `deleteAll`, `delete` or `nullify`, if that's the strategy. */
function statementFor(owner: Model, association: ResolvedAssociation): CompiledSql[] {
  const { dependent, foreignKey } = association.definition;
  let statement: Statement;
  if (dependent === "deleteAll" || dependent === "delete") {
    statement = recordsOf(owner, association).toDeleteAll();
  } else if (dependent === "nullify") {
    // The foreign key was checked as a target attribute when the Model was prepared.
    statement = recordsOf(owner, association).toUpdateAll({ [foreignKey]: null } as never);
  } else {
    return [];
  }
  return [statement[statementParts].query];
}
