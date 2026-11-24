// Signed ids (#517): `await user.signedId({ expiresIn, purpose })`, a record's primary key signed
// with its Model's secret, and finding the record again with `findSigned`, through a Relation's
// conditions and default scopes.
import { expiryAfter, type Duration } from "./durations.ts";
import type { Model, ModelClass } from "./model.ts";
import { signerOf } from "./signing-secret.ts";
import {
  lookUpToken,
  signableIdOf,
  signedPurposeOf,
  type TokenFinder,
  type TokenLookup,
} from "./token-records.ts";

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
function signedIdPurpose(model: ModelClass, purpose: string | undefined): string {
  return signedPurposeOf(model, purpose ?? null);
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

/** A record's signed id, made with its Model's newest secret. */
export async function signedIdOf(record: Model, options: SignedIdOptions = {}): Promise<string> {
  const model = record.constructor as ModelClass;
  const id = signableIdOf(record, "signedId");
  const expiresAt = expiryOf(options, "signedId");
  const signer = await signerOf(model, "signed id");
  return signer.sign(signedIdPurpose(model, options.purpose), {
    id,
    ...(expiresAt && { expiresAt }),
  });
}

/** Looks up the record a signed id finds through `finder`, if its Model's secret signed it for `purpose`. */
export async function findSigned<M extends Model>(
  finder: TokenFinder<M>,
  signedId: unknown,
  { purpose }: FindSignedOptions = {},
): Promise<TokenLookup<M>> {
  const signer = await signerOf(finder.model, "signed id");
  const signing = { signer, purpose: signedIdPurpose(finder.model, purpose) };
  return lookUpToken(finder, signing, signedId);
}
