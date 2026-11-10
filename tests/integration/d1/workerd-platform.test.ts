import { Miniflare } from "miniflare";
import { describe, expect, test } from "vite-plus/test";

/** What the fixture Worker reports, run in workerd with these compatibility flags. */
async function report(compatibilityFlags: string[]) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: new URL("../../fixtures/workerd/platform.mjs", import.meta.url).pathname,
    compatibilityDate: "2025-09-01",
    compatibilityFlags,
    d1Databases: ["DB"],
  });
  try {
    return await (await mf.dispatchFetch("http://localhost/")).json();
  } finally {
    await mf.dispose();
  }
}

// The library's levels rest on these; they can't be checked from Node, where the tests run.
describe("the Workers runtime, as Product.find(id) assumes it", () => {
  test("env.DB from cloudflare:workers is the handler's own, so a request's database matches its Models by binding", async () => {
    expect(await report(["nodejs_compat"])).toEqual({
      sameBinding: true,
      dynamicImport: true,
      asyncLocalStorage: true,
      inspectCustom: { depth: 2, stylize: "function", inspect: "function" },
      copiedResponse: { redirectImmutable: true, status: 303, setCookie: "a=1" },
    });
  });

  test("without Node.js compatibility, AsyncLocalStorage isn't there, so withDatabase says which setting to add", async () => {
    expect(await report([])).toMatchObject({ dynamicImport: true, asyncLocalStorage: false });
  });
});
