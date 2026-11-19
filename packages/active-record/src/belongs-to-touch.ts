// A belongsTo's `touch` (#353): checking its declaration, and the touches a record's create, update, destroy or touch makes of the records it belongs to, in its batch.
import { associationsOf, readAssociation } from "./association-fields.ts";
import type { AssociationDefinition } from "./associations.ts";
import { touchAssignments } from "./counters.ts";
import { InvalidModel } from "./errors.ts";
import { Model, modelOf, type ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import { isOnDifferentDatabases } from "./resolved-association.ts";
import { touchWrite } from "./touch.ts";
import type { PreparedWrite } from "./unit-of-work.ts";

/**
 * A belongsTo's `touch` is `true` or datetime attributes' names, each Model it points at has
 * what it sets, and it's on the record's database, as the touch is written in its batch.
 */
export function checkTouch(
  label: string,
  owner: ModelClass,
  definition: AssociationDefinition,
  targets: readonly ModelClass[],
): void {
  const { touch, kind } = definition;
  if (touch === undefined) return;
  if (kind !== "belongsTo") {
    throw new InvalidModel(`${label}: a ${kind} takes no touch; only a belongsTo touches`);
  }
  const names = touchNames(label, touch, targets);
  for (const target of targets) requireTouchable(label, target, touch === true ? [] : names);
  const elsewhere = targets.find((target) => isOnDifferentDatabases(owner, target));
  if (elsewhere !== undefined) {
    throw new InvalidModel(
      `${label} touches a record on another database, which it can't yet: ${owner.name} and ${elsewhere.name} must be on one`,
    );
  }
}

/** The names `touch` gives: none for `true`, else one or a list of strings. */
function touchNames(label: string, touch: unknown, targets: readonly ModelClass[]): string[] {
  if (touch === true) return [];
  const names = Array.isArray(touch) ? touch : [touch];
  if (names.length > 0 && names.every((name) => typeof name === "string")) return names;
  const models = targets.map((target) => target.name).join(" or ");
  throw new InvalidModel(
    `${label}: touch takes true, the name of a datetime attribute of ${models}, or a list of them`,
  );
}

/** `target` has `updatedAt` for `touch: true`, and each named attribute as a datetime. */
function requireTouchable(label: string, target: ModelClass, names: readonly string[]): void {
  const isDatetime = (name: string) => target.attributeDefinitions.get(name)?.type === "datetime";
  if (names.length === 0 && !isDatetime("updatedAt")) {
    throw new InvalidModel(
      `${label}: touch: true sets ${target.name}'s updatedAt, which it doesn't have (name a datetime attribute)`,
    );
  }
  const wrong = names.find((name) => !isDatetime(name));
  if (wrong !== undefined) {
    throw new InvalidModel(
      `${label}: touch takes ${target.name}'s datetime attributes; "${wrong}" isn't one`,
    );
  }
}

/** What a record's write is, which decides the records it touches. */
export type TouchCause = "insert" | "update" | "destroy" | "touch";

/**
 * One write's touches: the time each sets, the records already touched (by table and key, so
 * each is touched once), and the records the write saves or destroys itself.
 */
interface TouchSession {
  time: Date;
  touched: Set<string>;
  claimed: ReadonlySet<Model>;
}

/** Each write's touch session, by the set of records it claims. */
const sessions = new WeakMap<ReadonlySet<Model>, TouchSession>();

/** The touch session of the write claiming `claimed`, started on its first touch. */
function sessionOf(claimed: ReadonlySet<Model>): TouchSession {
  let session = sessions.get(claimed);
  if (session === undefined) {
    session = { time: new Date(), touched: new Set(), claimed };
    sessions.set(claimed, session);
  }
  return session;
}

/**
 * The touches `record`'s write makes (#353): each record a belongsTo declaring `touch` reaches,
 * loaded if it isn't, touched by its own touch write, and the records it touches in turn.
 */
export async function touchesOf(
  record: Model,
  cause: TouchCause,
  claimed: ReadonlySet<Model>,
): Promise<PreparedWrite[]> {
  const writes: PreparedWrite[] = [];
  for (const [name, { kind, touch }] of associationsOf(modelOf(record))) {
    if (kind !== "belongsTo" || touch === undefined) continue;
    for (const target of await touchedRecords(record, name, cause)) {
      writes.push(...(await touchOne(target, touch, claimed)));
    }
  }
  return writes;
}

/** The records `record`'s belongsTo `name` touches: the one it reaches, if it's saved. */
async function touchedRecords(record: Model, name: string, _cause: TouchCause): Promise<Model[]> {
  const current = await readAssociation(record, name);
  return isTouchable(current) ? [current] : [];
}

/** A saved record that isn't destroyed: one there is a row to touch. */
function isTouchable(record: unknown): record is Model {
  if (!(record instanceof Model)) return false;
  const recordState = record[state];
  return !recordState.isNew && !recordState.isDestroyed;
}

/**
 * `target`'s touch write, setting what `touch` names, then those it makes in turn; nothing if
 * this write has touched it already.
 */
async function touchOne(
  target: Model,
  touch: unknown,
  claimed: ReadonlySet<Model>,
): Promise<PreparedWrite[]> {
  const session = sessionOf(claimed);
  const model = modelOf(target);
  const key = `${model.table} ${JSON.stringify(target[state].storedKeyValue)}`;
  if (session.touched.has(key)) return [];
  session.touched.add(key);
  const values = Object.fromEntries(touchAssignments(model, touch, "touch", session.time));
  const write = touchWrite(target, values);
  return [write, ...(await touchesOf(target, "touch", claimed))];
}
