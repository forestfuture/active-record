// Signing a token's message (#517): `<payload>.<signature>`, base64url, its payload `[id, expiresAt?,
// fingerprint?]`, signed with HMAC-SHA256 over its purpose and payload, under keys HKDF-SHA256
// derives from the signing secrets for one feature, through WebCrypto.

/** What a token is for, so a key made for one never verifies another's. */
export type SigningFeature = "signed id" | "token for";

/** What a token says: a record's primary key, until when, and a value it depends on. */
interface SignedMessage {
  readonly id: string | number;
  readonly expiresAt?: Date;
  /** A value the token stays valid only while the record's is the same; only its fingerprint is kept. */
  readonly dependsOn?: unknown;
}

/** A token, verified: the id it holds, and a check of the value it depends on. */
export interface VerifiedMessage {
  readonly id: string | number;
  /** Whether `value` is the one the token was made with, by its fingerprint. */
  isUnchanged(value: unknown): Promise<boolean>;
}

/** Signs and verifies one feature's tokens with the secrets, newest first. */
export interface Signer {
  sign(purpose: string, message: SignedMessage): Promise<string>;
  /** What `token` holds, if one of the secrets signed it for `purpose` and it hasn't expired. */
  verify(purpose: string, token: string): Promise<VerifiedMessage | undefined>;
}

/** The bytes of a fingerprint kept in a token: enough that guessing one is hopeless. */
const FINGERPRINT_BYTES = 12;
const SIGNATURE_BYTES = 32;

/** base64url without padding. */
const BASE64URL = /^[\w-]+$/;

/** A signer for `feature`'s tokens: the first secret signs, and each one verifies. */
export function signerFor(secrets: readonly string[], feature: SigningFeature): Signer {
  const keys = secrets.map((secret) => keysFor(secret, feature));
  return {
    async sign(purpose, { id, expiresAt, dependsOn }) {
      const key = await keys[0]!;
      const fingerprint = dependsOn === undefined ? null : await fingerprintOf(key, dependsOn);
      const expiry = expiresAt === undefined ? null : Math.floor(expiresAt.getTime() / 1000);
      const payload = encode(
        new TextEncoder().encode(JSON.stringify(trimmed([id, expiry, fingerprint]))),
      );
      const signature = await crypto.subtle.sign("HMAC", key.signing, signed(purpose, payload));
      return `${payload}.${encode(new Uint8Array(signature))}`;
    },
    async verify(purpose, token) {
      const parts = partsOf(token);
      if (parts === undefined) return undefined;
      const signer = await signerOf(keys, signed(purpose, parts.payload), parts.signature);
      return signer === undefined ? undefined : messageIn(signer, parts.payload);
    },
  };
}

/** A token's payload and signature's bytes, or undefined when it isn't shaped as one. */
function partsOf(token: string): { payload: string; signature: Uint8Array } | undefined {
  const [payload = "", signature = "", ...rest] = token.split(".");
  if (rest.length > 0 || !BASE64URL.test(payload) || !BASE64URL.test(signature)) return undefined;
  const bytes = decode(signature);
  return bytes?.length === SIGNATURE_BYTES ? { payload, signature: bytes } : undefined;
}

/**
 * The keys whose signature `data` has, if any's. Every key is tried, so the time taken doesn't
 * say which signed it.
 */
async function signerOf(
  keys: readonly Promise<Keys>[],
  data: Uint8Array,
  signature: Uint8Array,
): Promise<Keys | undefined> {
  let signer: Keys | undefined;
  for (const each of keys) {
    const key = await each;
    if (await crypto.subtle.verify("HMAC", key.signing, signature, data)) signer ??= key;
  }
  return signer;
}

/** The keys one secret gives a feature: one signs tokens, the other makes fingerprints. */
interface Keys {
  readonly signing: CryptoKey;
  readonly fingerprinting: CryptoKey;
}

/**
 * Each secret's keys, by feature. Module-level, but not request state (ADR-0003): derived only
 * from the secret, which every request shares.
 */
const derived = new Map<string, Promise<Keys>>();

function keysFor(secret: string, feature: SigningFeature): Promise<Keys> {
  const cacheKey = `${feature}\n${secret}`;
  let keys = derived.get(cacheKey);
  if (keys === undefined) {
    keys = deriveKeys(secret, feature);
    derived.set(cacheKey, keys);
  }
  return keys;
}

async function deriveKeys(secret: string, feature: SigningFeature): Promise<Keys> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  const derive = (use: string) =>
    crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode("@forestfuture/active-record"),
        info: new TextEncoder().encode(`${feature} ${use}`),
      },
      material,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign", "verify"],
    );
  const [signing, fingerprinting] = await Promise.all([derive("signing"), derive("fingerprint")]);
  return { signing, fingerprinting };
}

/** What a token's signature covers: its purpose, quoted so no purpose runs into its payload. */
function signed(purpose: string, payload: string): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(purpose)}.${payload}`);
}

/** A value's fingerprint: its JSON, signed with the fingerprint key, cut short. */
async function fingerprintOf(keys: Keys, value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value) ?? "null");
  const signature = await crypto.subtle.sign("HMAC", keys.fingerprinting, json);
  return encode(new Uint8Array(signature).slice(0, FINGERPRINT_BYTES));
}

/** A payload without the nulls at its end. */
function trimmed(values: unknown[]): unknown[] {
  let end = values.length;
  while (end > 1 && values[end - 1] === null) end -= 1;
  return values.slice(0, end);
}

/** The message in a signed payload, unless it's expired or isn't one this module made. */
function messageIn(keys: Keys, payload: string): VerifiedMessage | undefined {
  const [id, expiry = null, fingerprint = null] = parsedPayload(payload) ?? [];
  const isId = typeof id === "string" || (typeof id === "number" && Number.isSafeInteger(id));
  if (!isId) return undefined;
  if (expiry !== null && (typeof expiry !== "number" || expiry * 1000 <= Date.now())) {
    return undefined;
  }
  return {
    id,
    async isUnchanged(value) {
      return typeof fingerprint === "string" && fingerprint === (await fingerprintOf(keys, value));
    },
  };
}

/** A payload's values, or undefined when it isn't a JSON array. */
function parsedPayload(payload: string): unknown[] | undefined {
  const bytes = decode(payload);
  if (bytes === undefined) return undefined;
  try {
    const values: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
    return Array.isArray(values) ? values : undefined;
  } catch {
    return undefined;
  }
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** base64url's bytes, or undefined for text that isn't base64url. */
function decode(text: string): Uint8Array | undefined {
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}
