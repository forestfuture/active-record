// The repo's own lint rules, loaded by vite.config.ts's `lint.jsPlugins`.
import { definePlugin } from "vite-plus/lint/plugins";
import moduleHeader from "./module-header.mjs";
import noFixedDelay from "./no-fixed-delay.mjs";

export default definePlugin({
  meta: { name: "d1-record" },
  rules: { "module-header": moduleHeader, "no-fixed-delay": noFixedDelay },
});
