// A token comes from outside (a link, a form, a query string), so for any text verifying it
// resolves to nothing, or to the message the secret signed, and never throws (#517). A token
// changed anywhere finds nothing. No database: these test the signing alone.
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { signerFor } from "../../packages/active-record/src/message-signing.ts";
import { SLOW_RUNS } from "../support/properties.ts";

const signer = signerFor(["a-signing-secret-of-at-least-32-bytes"], "token for");

/** Text shaped like a token, or not: base64url parts around dots, and any text at all. */
const tokenLike = fc.oneof(
  fc.string(),
  fc.string({ unit: "binary" }),
  fc
    .array(fc.stringMatching(/^[\w-]{0,60}$/), { minLength: 1, maxLength: 4 })
    .map((parts) => parts.join(".")),
);

const ids = fc.oneof(fc.string({ maxLength: 40 }), fc.integer());

describe("verifying any text as a token", () => {
  test("resolves to nothing, without throwing", async () => {
    await fc.assert(
      fc.asyncProperty(tokenLike, async (text) => {
        expect(await signer.verify("users", text)).toBeUndefined();
      }),
      SLOW_RUNS,
    );
  });

  test("finds a signed id again, and nothing once any character changes", async () => {
    await fc.assert(
      fc.asyncProperty(
        ids,
        fc.nat(),
        fc.string({ minLength: 1, maxLength: 1 }),
        async (id, at, replacement) => {
          const token = await signer.sign("users", { id, dependsOn: id });
          const index = at % token.length;
          fc.pre(token[index] !== replacement);
          const changed = `${token.slice(0, index)}${replacement}${token.slice(index + 1)}`;

          const verified = await signer.verify("users", token);

          expect(verified?.id).toBe(id);
          expect(await verified?.isUnchanged(id)).toBe(true);
          expect(await signer.verify("users", changed)).toBeUndefined();
        },
      ),
      SLOW_RUNS,
    );
  });
});
