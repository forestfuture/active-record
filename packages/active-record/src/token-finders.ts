// The Relation methods that find a record by a token (#517): `findSigned` and its `OrThrow`, with
// this Relation's conditions and default scopes, between Relation and its finders' modules so
// relation.ts stays the chainable query's own.
import { foundOrThrow } from "./finder-order.ts";
import type { Model, ModelClass } from "./model.ts";
import { queryOf, type QueryDescription } from "./query.ts";
import { findSigned, invalidOr, type FindSignedOptions, type TokenFinder } from "./signed-ids.ts";

/** The finders by token every Relation has. */
export abstract class TokenFinders<M extends Model> {
  /** @internal */
  abstract get [queryOf](): QueryDescription;
  abstract findBy(conditions: never): Promise<M | null>;

  /**
   * The record a signed id finds (`await user.signedId()`), if this Model's secret signed it for
   * the same `purpose` and it hasn't expired, and this Relation matches it; or null.
   */
  async findSigned(signedId: unknown, options?: FindSignedOptions): Promise<M | null> {
    return invalidOr(await findSigned(this.#finder, signedId, options), false, "signed id");
  }

  /** Like `findSigned`, but throws `InvalidToken` for a signed id that isn't valid, and `RecordNotFound` when its record is gone. */
  async findSignedOrThrow(signedId: unknown, options?: FindSignedOptions): Promise<M> {
    const found = invalidOr(await findSigned(this.#finder, signedId, options), true, "signed id");
    return foundOrThrow(this.#finder.model, found);
  }

  /** This Relation, as a token's record is found through it. */
  get #finder(): TokenFinder<M> {
    return {
      model: this[queryOf].model as ModelClass<M>,
      findBy: (conditions) => this.findBy(conditions),
    };
  }
}
