// A record's loaded associations: each kept while the key it was loaded for is current (#181, #189).

/** A loaded association, with the owner's attribute and key value it was loaded for. */
interface LoadedEntry {
  attribute: string;
  key: unknown;
  value: unknown;
}

/**
 * The associations one record has loaded (preloaded, read, or set by a write): a record, an
 * array of records, or null. Each stays loaded while the owner's attribute still holds the key
 * it was loaded for, and a load overtaken by a change to its association isn't kept.
 */
export class LoadedAssociations {
  /** The owner's attribute value now, which an entry's key is checked against. */
  readonly #keyOf: (attribute: string) => unknown;
  readonly #entries = new Map<string, LoadedEntry>();
  /** Counted when an association changes, by name and record-wide, so a stale load isn't kept. */
  readonly #loadsDiscarded = new Map<string, number>();
  #allLoadsDiscarded = 0;

  constructor(keyOf: (attribute: string) => unknown) {
    this.#keyOf = keyOf;
  }

  /** The loaded association, if it was loaded for the key the owner holds now. */
  get(name: string): { value: unknown } | undefined {
    const entry = this.#entries.get(name);
    if (entry === undefined || !Object.is(this.#key(entry.attribute), entry.key)) return undefined;
    return entry;
  }

  /**
   * Sets the association to what a write or preload made it, for the key `attribute` holds now;
   * loads of it already sent won't be kept.
   */
  set(name: string, attribute: string, value: unknown): void {
    this.#entries.set(name, { attribute, key: this.#key(attribute), value });
    this.#discardPendingLoads(name);
  }

  /**
   * Starts a load of the association, before its query is sent, for the key its query was built
   * for: the function it returns keeps the loaded value only if nothing changed the association
   * meanwhile (#181).
   */
  startLoad(name: string, attribute: string, key: unknown): (value: unknown) => void {
    const generation = this.#generation(name);
    return (value) => {
      if (this.#generation(name) === generation) this.#entries.set(name, { attribute, key, value });
    };
  }

  /** Forgets the association; loads of it already sent won't be kept. */
  clear(name: string): void {
    this.#entries.delete(name);
    this.#discardPendingLoads(name);
  }

  /** Forgets every association (`reload()`); loads already sent won't be kept. */
  clearAll(): void {
    this.#entries.clear();
    this.#allLoadsDiscarded += 1;
  }

  #key(attribute: string): unknown {
    return this.#keyOf(attribute) ?? null;
  }

  #discardPendingLoads(name: string): void {
    this.#loadsDiscarded.set(name, (this.#loadsDiscarded.get(name) ?? 0) + 1);
  }

  /**
   * Changes with each change to the association, so a load can tell whether it's still current.
   * The two counts are summed, so `clearAll()` makes every name stale without touching the map.
   */
  #generation(name: string): number {
    return this.#allLoadsDiscarded + (this.#loadsDiscarded.get(name) ?? 0);
  }
}
