import { describe, expect, test } from "vite-plus/test";
import redirect from "../../site/redirect/worker.ts";

const old = (path: string) =>
  redirect.fetch(new Request(`https://d1-record.forestfuture.dev${path}`));

// The guide moved to active-record.forestfuture.dev (#270); every old link still finds its page.
describe("the guide's old host", () => {
  test.each([
    "/",
    "/querying?tab=1#paginating",
    "/llms.txt",
    "/.well-known/agent-skills/index.json",
  ])("redirects %s permanently to the same path and query on the new host", (path) => {
    const response = old(path);

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      `https://active-record.forestfuture.dev${path.replace(/#.*/, "")}`,
    );
  });

  test("redirects every method, so a HEAD from a link checker sees it too", () => {
    const response = redirect.fetch(
      new Request("https://d1-record.forestfuture.dev/models", { method: "HEAD" }),
    );

    expect([response.status, response.headers.get("location")]).toEqual([
      301,
      "https://active-record.forestfuture.dev/models",
    ]);
  });
});
