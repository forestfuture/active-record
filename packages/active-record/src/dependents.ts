// What destroying a record does to its `dependent` associations, planned before the DELETE: on its database, or as separate writes on another's.
import { associationsOf } from "./association-fields.ts";
import { DeleteRestriction } from "./errors.ts";
import { addFailure } from "./errors-collection.ts";
import { humanAttributeName } from "./error-messages.ts";
import { prepareDestroy, refusalError, stagesOf, type Claimed } from "./lifecycle.ts";
import { modelOf, type Model, type ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import type { Scoped } from "./relation.ts";
import { statementParts, type Statement } from "./statement.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";
import { combine, stageOf, statementWrite, type Stage } from "./unit-of-work.ts";

/**
 * What an owner's `dependent:` associations add to its destroy, or why they refuse it: the
 * writes on its database, for its batch (`here`), and those on other databases (#228), written
 * there on their own before it (`elsewhere`).
 */
export type DependentsPlan = Dependents | { status: "restricted"; reason: string };

interface Dependents {
  status: "ready";
  here: Stage;
  elsewhere: Stage[];
}

/** A destroy with no dependents to write: a new record's. */
export const noDependents: Dependents = {
  status: "ready",
  here: stageOf({}, [], () => []),
  elsewhere: [],
};

/**
 * Prepares the owner's `dependent:` strategies, in the contract's order: restrictions first, so
 * a restricted owner touches nothing; then each `destroy` record's own prepared destroy (its
 * callbacks and dependents); then the `deleteAll`/`delete`/`nullify` statements. The caller
 * writes those on its database in one batch with the owner's DELETE, and the others before it.
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
  const here: Stage[] = [];
  const elsewhere: Stage[] = [];
  for (const association of dependencies) {
    const destroyed = await destroyRecords(owner, association, claimed);
    here.push(...destroyed.here);
    elsewhere.push(...destroyed.elsewhere);
  }
  for (const association of dependencies) {
    const statement = statementFor(owner, association);
    if (statement !== undefined) (association.crossesDatabases ? elsewhere : here).push(statement);
  }
  const [together = noDependents.here] = combine(here.map((stage) => [stage]));
  return { status: "ready", here: together, elsewhere };
}

/**
 * The dependent associations to another database that destroying a `model` record writes
 * through: every strategy but a restriction, which only reads, its own and those of the records
 * its `destroy` strategies destroy on its database, at every level.
 */
export function dependentsElsewhere(
  model: ModelClass,
  visited = new Set<ModelClass>(),
): ResolvedAssociation[] {
  if (visited.has(model)) return [];
  visited.add(model);
  return [...associationsOf(model)]
    .filter(([, { dependent }]) => dependent !== undefined && !dependent.startsWith("restrict"))
    .map(([name]) => resolveAssociation(model, name))
    .flatMap((association) => {
      if (association.crossesDatabases) return [association];
      const { dependent } = association.definition;
      return dependent === "destroy" ? dependentsElsewhere(association.target, visited) : [];
    });
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
 * `destroy`: each record's prepared destroy, callbacks and dependents included: in the owner's
 * batch (`here`), or for an association to another database, on its own before it. A record
 * that refuses stops the owner's destroy before anything is written.
 */
async function destroyRecords(
  owner: Model,
  association: ResolvedAssociation,
  claimed: Claimed,
): Promise<{ here: Stage[]; elsewhere: Stage[] }> {
  const destroyed = { here: [] as Stage[], elsewhere: [] as Stage[] };
  if (association.definition.dependent !== "destroy") return destroyed;
  for (const record of await recordsOf(owner, association).toArray()) {
    const plan = await prepareDestroy(record, claimed);
    if (plan.status !== "ready") throw refusalError(record, plan, "destroy");
    if (association.crossesDatabases) {
      destroyed.elsewhere.push(...stagesOf(plan));
    } else {
      destroyed.here.push(...plan.stages);
      destroyed.elsewhere.push(...plan.before);
    }
  }
  return destroyed;
}

/** The stage for `deleteAll`, `delete` or `nullify`'s statement, if that's the strategy. */
function statementFor(owner: Model, association: ResolvedAssociation): Stage | undefined {
  const { dependent, foreignKey } = association.definition;
  let statement: Statement;
  if (dependent === "deleteAll" || dependent === "delete") {
    statement = recordsOf(owner, association).toDeleteAll();
  } else if (dependent === "nullify") {
    // The foreign key was checked as a target attribute when the Model was prepared.
    statement = recordsOf(owner, association).toUpdateAll({ [foreignKey]: null } as never);
  } else {
    return undefined;
  }
  const { executor, query } = statement[statementParts];
  return stageOf({}, [], () => [statementWrite([query])], [executor]);
}
