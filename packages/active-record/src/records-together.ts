// Writing several records' saves or destroys as one, on their database: all of them, or none if one refuses.
import { withClaimedRecords } from "./around-callbacks.ts";
import { pinBefore } from "./executor.ts";
import {
  prepareDestroy,
  refusalError,
  type Claimed,
  type DestroyPlan,
  type Ready,
  type SavePlan,
} from "./lifecycle.ts";
import type { Model } from "./model.ts";
import { linksOf } from "./record-state.ts";
import { combine, inGroup, runStages, type Stage } from "./unit-of-work.ts";

/**
 * Destroys `records` as one write, callbacks and dependents included, as Rails' collection does
 * in a transaction: if one refuses, it throws, with nothing written.
 */
export async function destroyTogether(records: readonly Model[], needs: string): Promise<void> {
  await pinBefore(linksOf(records), needs);
  const refused = await writeTogether(records, prepareDestroy, needs);
  if (refused !== undefined) throw refusalError(refused.record, refused.plan, "destroy");
}

/**
 * Prepares each record's save or destroy, then writes them all as one: or, if one refuses, writes
 * nothing and returns it, with its plan.
 */
export async function writeTogether(
  records: readonly Model[],
  prepare: (record: Model, claimed: Claimed) => Promise<SavePlan | DestroyPlan>,
  needs: string,
): Promise<{ record: Model; plan: Exclude<SavePlan | DestroyPlan, Ready> } | undefined> {
  const kind = prepare === prepareDestroy ? "destroy" : "save";
  return withClaimedRecords(
    async (claimed) => {
      const plans: Ready[] = [];
      for (const record of records) {
        const plan = await prepare(record, claimed);
        if (plan.status !== "ready") return { record, plan };
        plans.push(plan);
      }
      await runStages(together(plans), needs);
      return undefined;
    },
    (refused) => refused && refusalError(refused.record, refused.plan, kind),
  );
}

/**
 * Several records' plans as one: what each writes on another database before, then their own
 * stages merged position by position, each one batch on their database, then what's after.
 */
function together(plans: readonly Ready[]): Stage[] {
  return [
    ...plans.flatMap((plan) => plan.before),
    ...inGroup(combine(plans.map((plan) => plan.stages)), {}),
    ...plans.flatMap((plan) => plan.after),
  ];
}
