// The repo's own lint rules, loaded by vite.config.ts's `lint.jsPlugins`.
import { definePlugin } from "vite-plus/lint/plugins";
import disableReason from "./disable-reason.mjs";
import moduleHeader from "./module-header.mjs";
import noFixedDelay from "./no-fixed-delay.mjs";
import standaloneTestName from "./standalone-test-name.mjs";

export default definePlugin({
  meta: { name: "active-record" },
  rules: {
    "disable-reason": disableReason,
    "module-header": moduleHeader,
    "no-fixed-delay": noFixedDelay,
    "standalone-test-name": standaloneTestName,
  },
});
