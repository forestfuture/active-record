// A record's private state: its values, changes, errors, and lifecycle flags.
import { type Attribute, attributeFor } from "./attribute.ts";
import type { Assignment } from "./compiler.ts";
import { Errors } from "./errors-collection.ts";
import { MissingAttribute, NoDatabase, RecordDestroyed } from "./errors.ts";
import type { Executor } from "./executor.ts";
import { LoadedAssociations } from "./loaded-associations.ts";
import { PendingAutosaves } from "./pending-autosaves.ts";
import { attributeOf, initialValues, type AttributeDefinition } from "./metadata.ts";
import type { ChangeOptions, Model, ModelClass } from "./model.ts";

/** @internal The hidden slot where a Record keeps its `RecordState`. */
export const state = Symbol("state");

/** Each record's link to its database (its `RecordState`), for pinning it to one (#93). */
export function linksOf(records: Iterable<Model>): RecordState[] {
  return [...records].map((record) => record[state]);
}

/** `{ attribute: [before, after] }` */
export type Changes = Record<string, [before: unknown, after: unknown]>;

type Lifecycle = "new" | "persisted" | "destroyed";

/**
 * Everything one Record knows about itself: its attribute values, lifecycle, the attributes
 * assigned since it was built, its Snapshot (each loaded attribute's stored form as last loaded
 * or saved), the changes its last save wrote, and the Database it belongs to.
 *
 * This is the only module that reads or writes those fields. Every rule about them (unloaded
 * attributes, undefined values, destroyed records, change detection) is enforced here.
 */
export class RecordState {
  readonly #model: ModelClass;
  #executor: Executor | undefined;
  #lifecycle: Lifecycle = "new";
  readonly #values: Record<string, unknown> = {};
  readonly #assigned = new Set<string>();
  readonly #snapshot = new Map<string, unknown>();
  /** The row the Snapshot was loaded from: its entries for the row's cells are made on first use (#91). */
  #snapshotRow: Record<string, unknown> | undefined;
  /** A new record's initial values in stored form, which `restore` returns attributes to. */
  readonly #initialValues = new Map<string, unknown>();
  #savedChanges: Changes = {};
  readonly #errors: Errors;
  #abortReason: string | undefined;
  /** The associations it has loaded, each kept while its key is current. */
  readonly associations = new LoadedAssociations((attribute) => this.#values[attribute]);
  /** The new records saving it also saves, built through or pointed at by its associations. */
  readonly autosaves = new PendingAutosaves();

  constructor(model: ModelClass) {
    this.#model = model;
    // `%{value}` in a message: an attribute that isn't one, or wasn't loaded, shows as nothing.
    const read = (name: string) => (Object.hasOwn(this.#values, name) ? this.#values[name] : null);
    this.#errors = new Errors({ model, read });
  }

  /** The record's validation errors, filled by the last validation run. */
  get errors(): Errors {
    return this.#errors;
  }

  /** Why a callback last refused a save or destroy; cleared at the start of each run. */
  get abortReason(): string | undefined {
    return this.#abortReason;
  }

  set abortReason(reason: string | undefined) {
    this.#abortReason = reason;
  }

  // Lifecycle and Database

  /** Not yet saved: built, or created but not persisted. */
  get isNew(): boolean {
    return this.#lifecycle === "new";
  }

  /** Backed by a row: loaded, or saved successfully. */
  get isPersisted(): boolean {
    return this.#lifecycle === "persisted";
  }

  /** Deleted by this instance: a read-only snapshot of the row. */
  get isDestroyed(): boolean {
    return this.#lifecycle === "destroyed";
  }

  /** Records belong to the Database they were built or loaded through (ADR-0003). */
  belongTo(executor: Executor): void {
    this.#executor = executor;
  }

  /** The record's Database; `NoDatabase` for a record constructed directly (`new User()`). */
  get executor(): Executor {
    if (this.#executor === undefined) {
      const { name } = this.#model;
      throw new NoDatabase(
        `${name} record has no Database; build or load records through db.model(${name})`,
      );
    }
    return this.#executor;
  }

  /**
   * Refuses to use a record as a live one when it can't be: a destroyed record is a read-only
   * snapshot, and a persisted record without its primary key (from `select(...).distinct()`)
   * has no identity to write by.
   */
  requireLive(action: string): void {
    this.#requireNotDestroyed(action);
    this.requireKey(action);
  }

  /** A persisted record needs its primary key to be found by; one from `distinct()` has none. */
  requireKey(action: string): void {
    const { name, primaryKey } = this.#model;
    if (this.#lifecycle === "persisted" && !this.#inSnapshot(primaryKey)) {
      throw new MissingAttribute(
        `${name} record has no primary key loaded (it came from select(...).distinct()); ` +
          `it can't ${action}`,
      );
    }
  }

  // Attributes

  /** An attribute's value; `MissingAttribute` if it wasn't loaded (left out of `select`). */
  read(name: string): unknown {
    this.#requireAttribute(name);
    if (!Object.hasOwn(this.#values, name)) {
      throw new MissingAttribute(
        `${this.#model.name} record has no "${name}" loaded; it was left out of select(...)`,
      );
    }
    return this.#values[name];
  }

  /**
   * Assigns one attribute. `undefined` throws `TypeError`, because it would silently store NULL
   * (use `null` for that); a destroyed record is read-only.
   */
  write(name: string, value: unknown): void {
    this.#requireNotDestroyed("be changed");
    this.#store(name, this.#attribute(name).cast(value));
  }

  /**
   * Writes a key copied from another record through `association`, cast as a condition's value
   * is (#94): an integer key into a text foreign key becomes its digits.
   */
  writeKey(name: string, value: unknown, association: string): void {
    this.#requireNotDestroyed("be changed");
    this.#store(name, this.#attribute(name).key(value, association));
  }

  /** Stores an attribute's already-cast value, as assigned. */
  #store(name: string, value: unknown): void {
    this.#values[name] = value;
    this.#assigned.add(name);
  }

  /** Assigns several attributes; unknown names throw `UnknownAttribute`. */
  assign(attributes: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(attributes)) {
      attributeOf(this.#model, name);
      this.write(name, value);
    }
  }

  /** A new record: every attribute reads as null until assigned, and initial values are made now. */
  build(attributes: Record<string, unknown>): void {
    for (const name of this.#model.attributeDefinitions.keys()) this.#values[name] = null;
    for (const [name, value] of initialValues(this.#model)) {
      this.write(name, value);
      this.#initialValues.set(name, this.#storedForm(name));
    }
    this.assign(attributes);
  }

  /** Points this record at `value` through `attribute` (a foreign key), keeping it loaded. */
  pointAt(name: string, attribute: string, key: unknown, value: unknown): void {
    this.writeKey(attribute, key, name);
    // After the write, so the association is loaded for the key as the foreign key stores it.
    this.associations.set(name, attribute, value);
  }

  /** Forgets an association: what's loaded and its autosaves (`reloadAssociation`). */
  resetAssociation(name: string): void {
    this.associations.clear(name);
    this.autosaves.clear(name);
  }

  /** Forgets every association, loaded and autosaved (`reload()`). */
  clearAssociations(): void {
    this.associations.clearAll();
    this.autosaves.clearAll();
  }

  /** Loads a D1 row; the record becomes persisted and clean. */
  loadRow(row: Record<string, unknown>): void {
    let loadedCount = 0;
    for (const [name, definition] of this.#model.attributeDefinitions) {
      const { column } = definition;
      if (!(column in row)) continue;
      this.#values[name] = this.#attribute(name).read(row[column]);
      loadedCount++;
    }
    this.#markSaved(row, loadedCount);
  }

  /** The loaded attributes as a plain object (the record's own values, not copies). */
  attributes(): Record<string, unknown> {
    return { ...this.#values };
  }

  // Changes

  /** A new record's assigned attributes, or a persisted one's that differ from the Snapshot. */
  changedNames(): string[] {
    if (this.#lifecycle === "new") return [...this.#assigned];
    return Object.keys(this.#values).filter(
      (name) => !this.#inSnapshot(name) || this.#snapshotOf(name) !== this.#storedForm(name),
    );
  }

  /** `{ attribute: [before, after] }`; both are copies, never the record's own objects. */
  changes(): Changes {
    const changes: Changes = {};
    for (const name of this.changedNames()) {
      const before = this.#inSnapshot(name) ? this.#snapshotValue(name) : null;
      changes[name] = [before, this.#copyOf(name)];
    }
    return changes;
  }

  /** `changes()`, with `undefined` before an attribute the record never loaded (a partial record's). */
  changesSinceLoad(): Changes {
    return Object.fromEntries(
      Object.entries(this.changes()).map(([name, [before, after]]) => [
        name,
        [this.#inSnapshot(name) ? before : undefined, after],
      ]),
    );
  }

  /** The changes the last successful save wrote (copies). */
  savedChanges(): Changes {
    return { ...this.#savedChanges };
  }

  /**
   * An attribute's value as last loaded or saved (a copy). A new record's is its initial
   * value (a default or generated id), or null, as Rails' `attribute_was` is.
   */
  valueInDatabase(name: string): unknown {
    this.read(name);
    const attribute = this.#attribute(name);
    if (this.#inSnapshot(name)) return this.#snapshotValue(name);
    return this.#initialValues.has(name) ? attribute.read(this.#initialValues.get(name)) : null;
  }

  /**
   * Whether the attribute has an unsaved change, optionally `from` and `to` given values
   * (compared as stored, so dates by time and json by content).
   */
  isAttributeChanged(name: string, options: ChangeOptions = {}): boolean {
    this.read(name);
    if (!this.changedNames().includes(name)) return false;
    return this.#matches(name, this.valueInDatabase(name), this.#values[name], options);
  }

  /** Whether the last save changed the attribute, optionally `from` and `to` given values. */
  hasSavedChangeTo(name: string, options: ChangeOptions = {}): boolean {
    this.read(name);
    const change = this.#savedChanges[name];
    return change !== undefined && this.#matches(name, change[0], change[1], options);
  }

  /** Puts unsaved changes back: to the Snapshot, or to a new record's initial values (or null). */
  restore(names: readonly string[] = this.changedNames()): void {
    this.#requireNotDestroyed("be changed");
    for (const name of names) {
      const attribute = this.#attribute(name);
      if (this.#lifecycle !== "new") {
        if (this.#inSnapshot(name)) this.#values[name] = this.#snapshotValue(name);
      } else if (this.#initialValues.has(name)) {
        this.#values[name] = attribute.read(this.#initialValues.get(name));
      } else {
        this.#values[name] = null;
        this.#assigned.delete(name);
      }
    }
  }

  #matches(name: string, before: unknown, after: unknown, options: ChangeOptions): boolean {
    const same = (a: unknown, b: unknown) => this.#attribute(name).same(a, b);
    return (
      (!("from" in options) || same(options.from, before)) &&
      (!("to" in options) || same(options.to, after))
    );
  }

  // Writes

  /** The attributes an insert writes: the assigned ones, so column defaults apply to the rest. */
  insertAssignments(): Assignment[] {
    return this.#assignmentsOf([...this.#assigned]);
  }

  /** The attributes an update writes: the changed ones. */
  updateAssignments(): Assignment[] {
    return this.#assignmentsOf(this.changedNames());
  }

  /** The primary key as stored in D1: the row's key before any unsaved change to it. */
  get storedKey(): unknown {
    return this.#snapshotOf(this.#model.primaryKey);
  }

  /** The stored primary key as a JavaScript value, e.g. to find the row again. */
  get storedKeyValue(): unknown {
    return this.#attribute(this.#model.primaryKey).read(this.storedKey);
  }

  /** After an insert: load what D1 stored; `savedChanges` is everything the new row holds. */
  commitInsert(row: Record<string, unknown> | undefined): void {
    if (row === undefined) {
      this.#settle();
      this.#markSaved();
    } else {
      this.loadRow(row);
    }
    this.#savedChanges = Object.fromEntries(
      Object.keys(this.#values)
        .filter((name) => this.#values[name] !== null)
        .map((name) => [name, [null, this.#copyOf(name)]]),
    );
  }

  /**
   * After an update: apply values the write added (timestamps), then record the save. Every
   * attribute holds what was stored (a `unixSeconds` Date has no milliseconds, a `json` NaN is
   * null), as an insert's re-read row gives (#73, #163), including one assigned a value equal
   * as stored, which wasn't a change.
   */
  commitUpdate(added: readonly Assignment[]): void {
    for (const [name, value] of added) this.#values[name] = value;
    this.#settle();
    this.#savedChanges = this.changes();
    this.#markSaved();
  }

  /** A save with nothing to write: nothing changes but `savedChanges`. */
  commitClean(): void {
    this.#savedChanges = {};
  }

  markDestroyed(): void {
    this.#lifecycle = "destroyed";
  }

  // Internals

  /** A destroyed record is a read-only snapshot. (A keyless record may change in memory.) */
  #requireNotDestroyed(action: string): void {
    if (this.#lifecycle === "destroyed") {
      throw new RecordDestroyed(`${this.#model.name} record was destroyed; it can't ${action}`);
    }
  }

  /** An unknown name is UnknownAttribute, even one every object inherits (`constructor`, #84). */
  #requireAttribute(name: string): void {
    this.#definition(name);
  }

  #definition(name: string): AttributeDefinition {
    return attributeOf(this.#model, name);
  }

  /** The resolved attribute, so a refusal names the Model and attribute. */
  #attribute(name: string): Attribute {
    return attributeFor(this.#model, name);
  }

  /** An attribute's current value in its stored form, for comparing with the Snapshot. */
  #storedForm(name: string): unknown {
    return this.#attribute(name).write(this.#values[name]);
  }

  /** A copy of an attribute's current value, read back from its stored form. */
  #copyOf(name: string): unknown {
    return this.#attribute(name).copy(this.#values[name]);
  }

  /** Every loaded attribute becomes what D1 holds for it: its value, written and read back. */
  #settle(): void {
    for (const name of Object.keys(this.#values)) this.#values[name] = this.#copyOf(name);
  }

  #assignmentsOf(names: readonly string[]): Assignment[] {
    return names.map((name): Assignment => [name, this.#values[name]]);
  }

  /**
   * The current values become the Snapshot: persisted and clean. After a load, the entries for
   * `row`'s cells (`loadedCount` of the values) are made only when first used, so a record that's
   * only read never writes them (#91).
   */
  #markSaved(row?: Record<string, unknown>, loadedCount = 0): void {
    this.#snapshot.clear();
    this.#snapshotRow = row;
    const names = Object.keys(this.#values);
    // Values the row didn't hold (none, unless a column is missing from it) are stored now.
    if (names.length !== loadedCount) {
      for (const name of names) {
        if (!this.#inRow(name)) this.#snapshot.set(name, this.#storedForm(name));
      }
    }
    this.#lifecycle = "persisted";
    this.#assigned.clear();
  }

  /** Whether the Snapshot has `name`: it was loaded or saved. */
  #inSnapshot(name: string): boolean {
    return this.#snapshot.has(name) || this.#inRow(name);
  }

  /** `name`'s Snapshot entry, its stored form, made from the loaded row's cell on first use. */
  #snapshotOf(name: string): unknown {
    if (this.#snapshot.has(name) || !this.#inRow(name)) return this.#snapshot.get(name);
    const attribute = this.#attribute(name);
    // #inRow said the row is held and has the cell.
    const stored = attribute.write(
      attribute.read(this.#snapshotRow![this.#definition(name).column]),
    );
    this.#snapshot.set(name, stored);
    return stored;
  }

  /** `name`'s value as loaded or saved: a fresh copy, read back from its Snapshot entry. */
  #snapshotValue(name: string): unknown {
    return this.#attribute(name).read(this.#snapshotOf(name));
  }

  /** Whether the row the Snapshot was loaded from has a cell for `name`. */
  #inRow(name: string): boolean {
    return this.#snapshotRow !== undefined && this.#definition(name).column in this.#snapshotRow;
  }
}
