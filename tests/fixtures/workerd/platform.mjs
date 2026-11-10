// What the library assumes of the Workers runtime for Product.find(id) (#77), checked inside
// workerd: see tests/integration/d1/workerd-platform.test.ts.
import { env as moduleEnv } from "cloudflare:workers";

export default {
  async fetch(_request, env) {
    const builtin = globalThis.process?.getBuiltinModule?.("node:async_hooks");
    // What a record's inspect (#104) needs: the symbol honored, and the options passed to it.
    let seen;
    const custom = {
      [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) {
        seen = { depth, stylize: typeof options.stylize, inspect: typeof inspect };
        return "custom";
      },
    };
    const util = globalThis.process?.getBuiltinModule?.("node:util");
    const printed = util?.inspect(custom);
    // What withSession (#220) needs: a redirect's headers can't change, and a copy's can.
    const redirect = Response.redirect("https://example.com/", 303);
    let redirectImmutable = false;
    try {
      redirect.headers.append("set-cookie", "a=1");
    } catch {
      redirectImmutable = true;
    }
    const copy = new Response(redirect.body, redirect);
    copy.headers.append("set-cookie", "a=1");
    return Response.json({
      copiedResponse: {
        redirectImmutable,
        status: copy.status,
        setCookie: copy.headers.get("set-cookie"),
      },
      inspectCustom: printed === "custom" ? seen : null,
      sameBinding: moduleEnv.DB === env.DB,
      dynamicImport: (await import("cloudflare:workers")).env.DB === env.DB,
      asyncLocalStorage: typeof builtin?.AsyncLocalStorage === "function",
    });
  },
};
