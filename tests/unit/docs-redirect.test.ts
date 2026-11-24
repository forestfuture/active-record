import { describe, expect, test } from "vite-plus/test";
import redirect from "../../site/redirect/worker.ts";

// The guide moved from d1-record.forestfuture.dev (#270), then from active-record.forestfuture.dev
// (#558), to arbor.forestfuture.dev; every old link still finds its page, in one hop.
describe.each(["d1-record.forestfuture.dev", "active-record.forestfuture.dev"])(
  "the guide's old host %s",
  (host) => {
    const old = (path: string, init?: RequestInit) =>
      redirect.fetch(new Request(`https://${host}${path}`, init));

    test.each([
      "/",
      "/querying?tab=1#paginating",
      "/llms.txt",
      "/.well-known/agent-skills/index.json",
    ])("redirects %s permanently to the same path and query on the new host", (path) => {
      const response = old(path);

      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe(
        `https://arbor.forestfuture.dev${path.replace(/#.*/, "")}`,
      );
    });

    test("redirects a HEAD request, as a link checker sends, to the same page", () => {
      const response = old("/models", { method: "HEAD" });

      expect([response.status, response.headers.get("location")]).toEqual([
        301,
        "https://arbor.forestfuture.dev/models",
      ]);
    });
  },
);
