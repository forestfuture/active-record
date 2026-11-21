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
    const [, iterations, salt, expected] = DIGEST.exec(digest) ?? [];
    if (iterations === undefined || salt === undefined || expected === undefined) {
      throw new TypeError(
        `The password digest isn't one PBKDF2-SHA256 made (${PREFIX}…); ` +
          "give the algorithm that made it as securePassword's algorithm",
      );
    }
    const key = await derive(password, fromBase64(salt), Number(iterations));
    return isSameBytes(key, fromBase64(expected));
  },
};

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

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}
