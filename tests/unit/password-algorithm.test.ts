// The default password algorithm (#355): PBKDF2-SHA256 through WebCrypto, its digest saying how
// it was made. These tests need no database.
import { describe, expect, test } from "vite-plus/test";
import { pbkdf2Sha256 } from "../../packages/active-record/src/password-algorithm.ts";

/** A digest made as the default algorithm makes one, with `iterations` of its own. */
async function digestWith(password: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(16).fill(7);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("=", "");
  return `$pbkdf2-sha256$i=${iterations}$${base64(salt)}$${base64(new Uint8Array(bits))}`;
}

describe("the default password algorithm", () => {
  test("makes a digest that says how it was made, without the password", async () => {
    const digest = await pbkdf2Sha256.hash("correct horse");

    expect(digest).toMatch(/^\$pbkdf2-sha256\$i=100000\$[\w+/]{22}\$[\w+/]{43}$/);
    expect(digest).not.toContain("correct horse");
  });

  test("salts each digest, so one password makes different digests", async () => {
    const [first, second] = await Promise.all([
      pbkdf2Sha256.hash("correct horse"),
      pbkdf2Sha256.hash("correct horse"),
    ]);

    expect(first).not.toBe(second);
  });

  test("verifies the password a digest was made from, and no other", async () => {
    const digest = await pbkdf2Sha256.hash("correct horse");

    expect(await pbkdf2Sha256.verify("correct horse", digest)).toBe(true);
    expect(await pbkdf2Sha256.verify("correct horse ", digest)).toBe(false);
    expect(await pbkdf2Sha256.verify("", digest)).toBe(false);
  });

  test("verifies a digest made with another iteration count", async () => {
    const digest = await digestWith("battery staple", 1000);

    expect(await pbkdf2Sha256.verify("battery staple", digest)).toBe(true);
    expect(await pbkdf2Sha256.verify("battery", digest)).toBe(false);
  });

  test("hashes a password's UTF-8 bytes", async () => {
    const digest = await digestWith("pässwörd", 1000);

    expect(await pbkdf2Sha256.verify("pässwörd", digest)).toBe(true);
  });

  test("allows at most 72 bytes", () => {
    expect(pbkdf2Sha256.maxBytes).toBe(72);
  });

  test("throws for a digest it didn't make", async () => {
    const bcrypt = "$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";

    await expect(pbkdf2Sha256.verify("secret", bcrypt)).rejects.toThrow(
      new TypeError(
        "The password digest isn't one PBKDF2-SHA256 made ($pbkdf2-sha256$…); " +
          "give the algorithm that made it as securePassword's algorithm",
      ),
    );
  });
});
