// Signed ids (#517): `await user.signedId({ expiresIn, purpose })`, a record's primary key signed
// with its Model's secret, and finding the record again with `findSigned`, through a Relation's
// conditions and default scopes.
import { expiryAfter, type Duration } from "./durations.ts";
import { InvalidToken, RecordNotSaved } from "./errors.ts";
import type { VerifiedMessage } from "./message-signing.ts";
import { asStored } from "./normalized-values.ts";
import type { Model, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import { signerOf } from "./signing-secret.ts";

/** What a signed id is for, and how long it lasts: forever unless given. */
export interface SignedIdOptions {
  /** How long it lasts: `{ minutes: 15 }`. Give this or `expiresAt`. */
  readonly expiresIn?: Duration;
  /** When it stops finding its record. */
  readonly expiresAt?: Date;
  /** What it's for (`"login"`): `findSigned` finds its record only given the same. */
  readonly purpose?: string;
}

/** What `findSigned` takes: the purpose the signed id was made for. */
export interface FindSignedOptions {
  readonly purpose?: string;
}

/** What a signed id is signed for: its Model's table, and its purpose. */
function purposeOf(model: ModelClass, purpose: string | undefined): string {
  return JSON.stringify([model.table, purpose ?? null]);
}

/** When a token expires: `expiresAt`, or `expiresIn` from now; `TypeError` for both. */
function expiryOf(
  { expiresIn, expiresAt }: { expiresIn?: Duration; expiresAt?: Date },
  where: string,
): Date | undefined {
  if (expiresIn !== undefined && expiresAt !== undefined) {
    throw new TypeError(`${where} takes expiresIn or expiresAt, not both`);
  }
  if (expiresIn !== undefined) return expiryAfter(expiresIn, `${where}'s expiresIn`);
  if (
    expiresAt !== undefined &&
    !(expiresAt instanceof Date && Number.isFinite(expiresAt.getTime()))
  ) {
    throw new TypeError(`${where}'s expiresAt must be a valid Date`);
  }
  return expiresAt;
}

/** A saved record's primary key, which a token holds; `RecordNotSaved` for a new record. */
export function signableIdOf(record: Model, method: string): string | number {
  const model = record.constructor as ModelClass;
  if (record[state].isNew) {
    throw new RecordNotSaved(
      `${model.name} record hasn't been saved, so ${method} has no id to sign`,
    );
  }
  return record[state].read(model.primaryKey) as string | number;
}

/** A record's signed id, made with its Model's newest secret. */
export async function signedIdOf(record: Model, options: SignedIdOptions = {}): Promise<string> {
  const model = record.constructor as ModelClass;
  const id = signableIdOf(record, "signedId");
  const expiresAt = expiryOf(options, "signedId");
  const signer = await signerOf(model, "signed id");
  return signer.sign(purposeOf(model, options.purpose), { id, ...(expiresAt && { expiresAt }) });
}

/** What finds a token's record: a Relation, its conditions and default scopes kept. */
export interface TokenFinder<M extends Model> {
  readonly model: ModelClass<M>;
  findBy(conditions: never): Promise<M | null>;
}

/** The record a verified token's id finds, through the finder; or null. */
export async function recordOf<M extends Model>(
  finder: TokenFinder<M>,
  verified: VerifiedMessage,
): Promise<M | null> {
  return finder.findBy(asStored({ [finder.model.primaryKey]: verified.id }) as never);
}

/**
 * The record a signed id finds, if one of its Model's secrets signed it for `purpose` and it
 * hasn't expired; null otherwise, and for a value that isn't a string. With `orThrow`, a token
 * that isn't valid throws `InvalidToken`, and one whose record is gone `RecordNotFound`.
 */
export async function findSigned<M extends Model>(
  finder: TokenFinder<M>,
  signedId: unknown,
  { purpose }: FindSignedOptions = {},
): Promise<M | null | typeof invalid> {
  const signer = await signerOf(finder.model, "signed id");
  if (typeof signedId !== "string") return invalid;
  const verified = await signer.verify(purposeOf(finder.model, purpose), signedId);
  return verified === undefined ? invalid : recordOf(finder, verified);
}

/** What a finder resolves to for a token that isn't valid, before its `OrThrow` decides. */
export const invalid = Symbol("invalid");

/** A token finder's result: null for an invalid token, or `InvalidToken` when it must find one. */
export function invalidOr<M>(result: M | typeof invalid, orThrow: boolean, what: string): M | null {
  if (result !== invalid) return result;
  if (orThrow)
    throw new InvalidToken(
      `The ${what} isn't valid: it's changed, expired, or for another purpose`,
    );
  return null;
}
