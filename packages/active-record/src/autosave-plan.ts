// A save's autosaves, validated and planned (#44): the records it writes before and after its owner, and the stages they're written in, on its database or another.
import {
  autosavedAfter,
  autosavedBefore,
  dropUnsavedMarked,
  forget,
  keysKnownBefore,
  linkAfter,
  linkBefore,
  ownerKeyKnown,
  unlink,
  type Linked,
} from "./autosave.ts";
import {
  prepareDestroy,
  prepareWrites,
  stagesOf,
  validation,
  type Claimed,
  type Ready,
  type SavePlan,
} from "./lifecycle.ts";
import { addFailure } from "./errors-collection.ts";
import type { Model } from "./model.ts";
import { state } from "./record-state.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";
import { afterLinking, combine, inGroup, stageOf, type Stage } from "./unit-of-work.ts";

/** A save that won't be written: a record it autosaves was refused. */
type Refusal = Exclude<SavePlan, Ready>;

/** A record's prepared writes, with the association its owner writes it through. */
export interface Planned extends Linked {
  plan: Ready;
}

/** What an owner writes before itself, prepared: the records it points at, and the saves of those still new. */
export interface PlannedBefore {
  pointedAt: readonly Linked[];
  planned: readonly Planned[];
  /** The marked records it destroys after its own write (#37). */
  destroyed: readonly Planned[];
}

/**
 * The records an owner autosaves are validated with it, one after another, as Rails'
 * `validate: true` does: an invalid one adds "is invalid" to its association's name, or with
 * `autosave: true` its errors, each under the association's name (`posts.title`), as Rails does.
 */
export async function validateAutosaves(owner: Model, claimed: Claimed): Promise<void> {
  await validateEach(owner, autosavedBefore(owner, claimed).saved, claimed);
  await validateEach(owner, autosavedAfter(owner, claimed), claimed);
}

/**
 * Validates each record, then adds "is invalid" once for each association with an invalid one
 * whose errors aren't copied: one without `autosave: true`, or a record with none to copy, which a
 * callback aborted.
 */
async function validateEach(owner: Model, linked: readonly Linked[], claimed: Claimed) {
  const invalid = new Set<string>();
  for (const { association, record, destroys } of linked) {
    if (destroys || (await validation(record, claimed)) === "valid") continue;
    const copied =
      association.definition.autosave === true && copyErrors(owner, association, record);
    if (!copied) invalid.add(association.name);
  }
  for (const name of invalid) owner[state].errors.add(name, { type: "invalid" });
}

/** Copies the record's errors onto the owner, each under the association's name; `false` if none. */
function copyErrors(owner: Model, { name }: ResolvedAssociation, record: Model): boolean {
  const errors = record[state].errors.toArray();
  for (const { attribute, type, message, values } of errors) {
    owner[state].errors[addFailure](`${name}.${attribute}`, { type, message, values });
  }
  return errors.length > 0;
}

/** The saves of the new records `owner` points at, prepared before its own. */
export async function prepareBefore(
  owner: Model,
  claimed: Claimed,
): Promise<PlannedBefore | Refusal> {
  const before = autosavedBefore(owner, claimed);
  const planned = await prepareEach(owner, before.saved, claimed);
  if (!Array.isArray(planned)) return planned;
  const destroyed = await prepareEach(owner, before.destroyed, claimed);
  if (!Array.isArray(destroyed)) return destroyed;
  return { pointedAt: before.pointedAt, planned, destroyed };
}

/** The saves and destroys of the records `owner` writes after itself, prepared once its own is. */
export async function prepareAfter(owner: Model, claimed: Claimed): Promise<Planned[] | Refusal> {
  return prepareEach(owner, autosavedAfter(owner, claimed), claimed);
}

/**
 * Each record's prepared save or destroy, in order; the first refusal stops them. A record
 * another of the owner's associations holds too, already prepared, isn't prepared again.
 */
async function prepareEach(
  owner: Model,
  linked: readonly Linked[],
  claimed: Claimed,
): Promise<Planned[] | Refusal> {
  const plans: Planned[] = [];
  for (const each of linked) {
    if (claimed.has(each.record)) continue;
    const plan = each.destroys
      ? await prepareMarked(owner, each, claimed)
      : await prepareWrites(each.record, claimed);
    if (plan.status !== "ready") return plan;
    plans.push({ ...each, plan });
  }
  return plans;
}

/**
 * A marked record's destroy, with its callbacks and `dependent:` strategies, as any destroy's;
 * once it's written, the record leaves the owner's association.
 */
async function prepareMarked(
  owner: Model,
  { association, record }: Linked,
  claimed: Claimed,
): Promise<Ready | Refusal> {
  const plan = await prepareDestroy(record, claimed);
  if (plan.status !== "ready") return { status: "notDestroyed", reason: plan.reason };
  const left = stageOf(record, [], () => [
    { statements: [], commit: () => forget(owner, association, record), after: async () => {} },
  ]);
  return { ...plan, stages: combine([plan.stages, [left]]) };
}

/**
 * Readies the owner's links just before its write is built, once nothing can refuse the save: it
 * points at the new records it saved first, stops pointing at the ones it destroys after it, and
 * drops the marked records it never saved from its associations (#37).
 */
export function linkOwner(owner: Model, before: PlannedBefore): void {
  linkBefore(owner, before.pointedAt);
  unlink(owner, before.destroyed);
  dropUnsavedMarked(owner);
}

/** Whether a record is written on its owner's database. */
const isHere = (each: { association: ResolvedAssociation }) => !each.association.isCrossDatabase;

/**
 * An owner's save plan, from its own stage and its autosaves'. The records it autosaves on its
 * database join its stages: the new records it points at in its batch when their keys are known,
 * else in the one before; those saved after it as `withAfter` says. Those on another database
 * (#228) are written there separately, as Rails does, by the association: the ones it points at
 * before it, and the others after it.
 */
export function assemble(
  owner: Model,
  own: Stage,
  before: PlannedBefore,
  after: readonly Planned[],
): Ready {
  const first = before.planned.filter(isHere);
  const children = after.filter(isHere);
  const gone = before.destroyed.filter(isHere);
  // A belongsTo's marked records go in the owner's batch, after it: it no longer points at them.
  let stages = combine([withAfter(owner, own, children), ...gone.map(({ plan }) => plan.stages)]);
  if (first.length > 0) {
    const firstStages = combine(first.map(({ plan }) => plan.stages));
    const known = keysKnownBefore(before.pointedAt.filter(isHere));
    stages = known ? combine([firstStages, stages]) : [...firstStages, ...stages];
  }
  const nested = [...first, ...children, ...gone].map(({ plan }) => plan);
  const elsewhere = (planned: readonly Planned[]) => planned.filter((each) => !isHere(each));
  return {
    status: "ready",
    // Every one on its database, the records it autosaves there included, so pinned together.
    stages: inGroup(stages, owner),
    before: [
      ...elsewhere(before.planned).flatMap(({ plan }) => stagesOf(plan)),
      ...nested.flatMap((plan) => plan.before),
    ],
    after: [
      ...nested.flatMap((plan) => plan.after),
      ...savedElsewhere(owner, elsewhere(after)),
      ...elsewhere(before.destroyed).flatMap(({ plan }) => stagesOf(plan)),
    ],
  };
}

/**
 * The owner's stage with those of the records saved after it: in the same batch when the owner's
 * key is known, else in the next one. The records are linked to the owner just before their first
 * stage builds its statements.
 */
function withAfter(owner: Model, own: Stage, planned: readonly Planned[]): Stage[] {
  if (planned.length === 0) return [own];
  const [first, ...rest] = combine(planned.map(({ plan }) => plan.stages));
  const linked = [afterLinking(first!, () => linkAfter(owner, planned)), ...rest];
  return ownerKeyKnown(owner, planned) ? combine([[own], linked]) : [own, ...linked];
}

/**
 * The stages of the records saved after `owner` on other databases: each association's records
 * together, on its database. They're linked to the owner's key, which it has by then, just before
 * the first.
 */
function savedElsewhere(owner: Model, planned: readonly Planned[]): Stage[] {
  const associations = [...new Set(planned.map(({ association }) => association))];
  const stages = associations.flatMap((association) => {
    const plans = planned
      .filter((each) => each.association === association)
      .map(({ plan }) => plan);
    return [
      ...plans.flatMap((plan) => plan.before),
      ...inGroup(combine(plans.map((plan) => plan.stages)), association),
      ...plans.flatMap((plan) => plan.after),
    ];
  });
  const [first, ...rest] = stages;
  if (first === undefined) return [];
  return [afterLinking(first, () => linkAfter(owner, planned)), ...rest];
}
