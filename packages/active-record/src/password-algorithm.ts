// Password algorithms (#355): what hashes a secure password into its digest and verifies one, and
// the default, PBKDF2-SHA256 through WebCrypto, which every Worker has.

/**
 * What hashes a secure password and verifies it against a digest: the default, or an app's own
 * (bcrypt, to read digests another app made).
 */
export interface PasswordAlgorithm {
  /** A digest of `password`, salted, that `verify` can check it against. */
  hash(password: string): Promise<string>;
  /** Whether `password` is the one `digest` was made from. */
  verify(password: string, digest: string): Promise<boolean>;
  /** The most bytes a password may be, in UTF-8; without it, any length. */
  readonly maxBytes?: number;
}

/**
 * The iterations a new digest takes: the most Workers allow in production, as each request's CPU
 * time can't stop PBKDF2 once it's started.
 */
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const PREFIX = "$pbkdf2-sha256$";

/** `$pbkdf2-sha256$i=<iterations>$<salt>$<key>`, each part in base64 without padding. */
const DIGEST = /^\$pbkdf2-sha256\$i=(\d{1,9})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/**
 * The default algorithm: PBKDF2 with HMAC-SHA256, a 16-byte salt, and the iterations its digest
 * names, so a digest made with another count still verifies. At most 72 bytes, as bcrypt's.
 */
export const pbkdf2Sha256: PasswordAlgorithm = {
  maxBytes: 72,
  async hash(password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const key = await derive(password, salt, ITERATIONS);
    return `${PREFIX}i=${ITERATIONS}$${toBase64(salt)}$${toBase64(key)}`;
  },
  async verify(password, digest) {
    const { iterations, salt, key } = parsed(digest);
    return isSameBytes(await derive(password, salt, iterations), key);
  },
};

/**
 * The fewest and most iterations a digest may name: a digest is data, so one naming a count no
 * digest this algorithm made could have would weaken a check, or stall it.
 */
const FEWEST_ITERATIONS = 1_000;
const MOST_ITERATIONS = 10_000_000;

/** A digest's parts; `TypeError` for one this algorithm couldn't have made. */
function parsed(digest: string): { iterations: number; salt: Uint8Array; key: Uint8Array } {
  const [, count = "", salt = "", key = ""] = DIGEST.exec(digest) ?? [];
  const iterations = Number(count);
  const decoded = { iterations, salt: fromBase64(salt), key: fromBase64(key) };
  const isMade =
    iterations >= FEWEST_ITERATIONS &&
    iterations <= MOST_ITERATIONS &&
    decoded.salt.length === SALT_BYTES &&
    decoded.key.length === KEY_BITS / 8;
  if (!isMade) {
    throw new TypeError(
      `The password digest isn't one PBKDF2-SHA256 made (${PREFIX}…); ` +
        "give the algorithm that made it as securePassword's algorithm",
    );
  }
  return decoded;
}

/** PBKDF2-SHA256's key for `password`'s UTF-8 bytes. */
async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Whether two keys are the same, in a time that doesn't depend on where they differ. */
function isSameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("=", "");
}

/** Base64's bytes; none for text that isn't base64, which a digest's check then refuses. */
function fromBase64(text: string): Uint8Array {
  try {
    return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}
