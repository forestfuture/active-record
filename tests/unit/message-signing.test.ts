// Signing a token's message (#517): HMAC-SHA256 over its purpose and payload, with keys derived
// from the signing secrets, newest first. These tests need no database.
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { signerFor } from "../../packages/active-record/src/message-signing.ts";

const secret = "s".repeat(32);
const older = "o".repeat(32);

afterEach(() => {
  vi.useRealTimers();
});

/** `token` with one character of its payload changed. */
function tampered(token: string): string {
  const swapped = token[0] === "W" ? "X" : "W";
  return `${swapped}${token.slice(1)}`;
}

describe("a signer", () => {
  test("verifies the id it signed, for the purpose it signed it for", async () => {
    const signer = signerFor([secret], "signed id");
    const token = await signer.sign("users", { id: 7 });

    expect(token).toMatch(/^[\w-]+\.[\w-]{43}$/);
    expect((await signer.verify("users", token))?.id).toBe(7);
    expect((await signer.verify("users/login", token))?.id).toBeUndefined();
  });

  test("keeps a text id as text", async () => {
    const signer = signerFor([secret], "signed id");
    const token = await signer.sign("users", { id: "01J9Zé" });

    expect((await signer.verify("users", token))?.id).toBe("01J9Zé");
  });

  test("refuses a token whose payload or signature changed", async () => {
    const signer = signerFor([secret], "signed id");
    const token = await signer.sign("users", { id: 7 });
    const [payload] = token.split(".");

    expect(await signer.verify("users", tampered(token))).toBeUndefined();
    expect(await signer.verify("users", `${payload}.${"A".repeat(43)}`)).toBeUndefined();
    expect(await signer.verify("users", payload!)).toBeUndefined();
    expect(await signer.verify("users", "not a token")).toBeUndefined();
    expect(await signer.verify("users", "")).toBeUndefined();
  });

  test("verifies one spelling of a token only", async () => {
    const signer = signerFor([secret], "signed id");
    const token = await signer.sign("users", { id: 7 });
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(token.at(-1)!);
    // A signature's last character holds 2 bits that aren't the signature's: the same bytes.
    const respelled = [1, 2, 3].map((spare) => `${token.slice(0, -1)}${alphabet[last ^ spare]}`);

    const verified = await Promise.all(respelled.map((each) => signer.verify("users", each)));

    expect(verified).toEqual([undefined, undefined, undefined]);
  });

  test("refuses a token longer than any it makes without checking its signature", async () => {
    const signer = signerFor([secret], "signed id");
    const token = await signer.sign("users", { id: 7 });
    const verify = vi.spyOn(crypto.subtle, "verify");

    const verified = await signer.verify("users", `${"A".repeat(1_000_000)}${token}`);

    expect(verified).toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
    verify.mockRestore();
  });

  test("refuses to sign an id that makes a token over 1,024 characters", async () => {
    const signer = signerFor([secret], "signed id");

    await expect(signer.sign("users", { id: "x".repeat(1000) })).rejects.toThrow(TypeError);
  });

  test("refuses a payload that isn't an id, though signed", async () => {
    const signer = signerFor([secret], "signed id");
    const forged = await signer.sign("users", { id: { nested: true } as never });

    expect(await signer.verify("users", forged)).toBeUndefined();
  });

  test("refuses another feature's token, though made from the same secret", async () => {
    const token = await signerFor([secret], "signed id").sign("users", { id: 7 });

    expect(await signerFor([secret], "token for").verify("users", token)).toBeUndefined();
  });

  test("refuses a token another secret signed", async () => {
    const token = await signerFor([older], "signed id").sign("users", { id: 7 });

    expect(await signerFor([secret], "signed id").verify("users", token)).toBeUndefined();
  });

  test("signs with the newest secret and verifies with every one", async () => {
    const fromOlder = await signerFor([older], "signed id").sign("users", { id: 7 });
    const rotated = signerFor([secret, older], "signed id");
    const fromNewest = await rotated.sign("users", { id: 8 });

    expect((await rotated.verify("users", fromOlder))?.id).toBe(7);
    expect((await signerFor([secret], "signed id").verify("users", fromNewest))?.id).toBe(8);
  });

  test("refuses a token once it expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
    const signer = signerFor([secret], "signed id");
    const expiresAt = new Date("2026-11-21T12:15:00Z");
    const token = await signer.sign("users", { id: 7, expiresAt });

    vi.setSystemTime(new Date("2026-11-21T12:14:59Z"));
    expect((await signer.verify("users", token))?.id).toBe(7);
    vi.setSystemTime(new Date("2026-11-21T12:15:00Z"));
    expect(await signer.verify("users", token)).toBeUndefined();
  });

  test("refuses to sign an expiry that isn't a time", async () => {
    const signer = signerFor([secret], "signed id");

    await expect(signer.sign("users", { id: 7, expiresAt: new Date(Number.NaN) })).rejects.toThrow(
      TypeError,
    );
    await expect(
      signer.sign("users", { id: 7, expiresAt: { getTime: () => Infinity } as never }),
    ).rejects.toThrow(TypeError);
  });

  test("says whether a value it depends on is unchanged, without carrying it", async () => {
    const signer = signerFor([secret, older], "token for");
    const token = await signer.sign("users", { id: 7, dependsOn: "jane@example.com" });
    const verified = await signer.verify("users", token);

    expect(atob(token.split(".")[0]!.replaceAll("-", "+").replaceAll("_", "/"))).not.toContain(
      "jane",
    );
    expect(await verified?.isUnchanged("jane@example.com")).toBe(true);
    expect(await verified?.isUnchanged("sam@example.com")).toBe(false);
  });

  test("checks a value it depends on with the secret that signed it", async () => {
    const token = await signerFor([older], "token for").sign("users", {
      id: 7,
      dependsOn: { email: "jane@example.com", version: 2 },
    });
    const verified = await signerFor([secret, older], "token for").verify("users", token);

    expect(await verified?.isUnchanged({ email: "jane@example.com", version: 2 })).toBe(true);
  });

  test("fingerprints a value apart for each record and purpose", async () => {
    const signer = signerFor([secret], "token for");
    const fingerprint = async (purpose: string, id: number) => {
      const token = await signer.sign(purpose, { id, dependsOn: "member" });
      const payload = atob(token.split(".")[0]!.replaceAll("-", "+").replaceAll("_", "/"));
      return (JSON.parse(payload) as unknown[])[2];
    };

    const fingerprints = [
      await fingerprint("users", 7),
      await fingerprint("users", 8),
      await fingerprint("users/login", 7),
    ];

    expect(new Set(fingerprints).size).toBe(3);
  });

  test("never matches a value a token without one depends on", async () => {
    const signer = signerFor([secret], "token for");
    const verified = await signer.verify("users", await signer.sign("users", { id: 7 }));

    expect(await verified?.isUnchanged("jane@example.com")).toBe(false);
  });
});
