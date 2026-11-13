// A record's pending autosaves: the records built or pushed through its associations, or a new one a belongsTo points at.
import type { Model } from "./model.ts";

/**
 * The records saving one record may also save: those built through its hasMany and hasOne
 * associations or pushed onto a hasMany, after it (`autosavesOf` says which), and the new ones
 * its belongsTo associations point at, before it.
 */
export class PendingAutosaves {
  readonly #built = new Map<string, Model[]>();
  readonly #belongsTo = new Map<string, Model>();

  /** A record built through one of this record's hasMany or hasOne associations. */
  addBuilt(name: string, record: Model): void {
    this.#built.set(name, [...(this.#built.get(name) ?? []), record]);
  }

  /** Takes `records` out of those built through the association (`delete`, `destroy`). */
  removeBuilt(name: string, records: readonly Model[]): void {
    const kept = this.built(name).filter((record) => !records.includes(record));
    this.#built.set(name, kept);
  }

  /** A hasOne's one record to save with this record, replacing any before it. */
  setBuilt(name: string, record: Model): void {
    this.#built.set(name, [record]);
  }

  /** The records built through the association, in the order they were built. */
  built(name: string): readonly Model[] {
    return this.#built.get(name) ?? [];
  }

  /** Every association's built records, by association name. */
  allBuilt(): [name: string, records: readonly Model[]][] {
    return [...this.#built];
  }

  /** A new record a belongsTo points at, saved first when this record is; undefined clears it. */
  setBelongsTo(name: string, record: Model | undefined): void {
    if (record === undefined) this.#belongsTo.delete(name);
    else this.#belongsTo.set(name, record);
  }

  /** The new records this record's belongsTo associations point at, by association name. */
  allBelongsTo(): [name: string, record: Model][] {
    return [...this.#belongsTo];
  }

  /** Forgets what was built through the association or set on it (`reloadAssociation`). */
  clear(name: string): void {
    this.#built.delete(name);
    this.#belongsTo.delete(name);
  }

  /** Forgets every association's (`reload()`). */
  clearAll(): void {
    this.#built.clear();
    this.#belongsTo.clear();
  }
}
