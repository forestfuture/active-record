// The repo's own lint rules, loaded by vite.config.ts's `lint.jsPlugins`.
import { definePlugin } from "vite-plus/lint/plugins";
import disableReason from "./disable-reason.mjs";
import moduleHeader from "./module-header.mjs";
import noFixedDelay from "./no-fixed-delay.mjs";
import noSqlText from "./no-sql-text.mjs";
import predicateName from "./predicate-name.mjs";
import standaloneTestName from "./standalone-test-name.mjs";

export default definePlugin({
  meta: { name: "active-record" },
  rules: {
    "disable-reason": disableReason,
    "module-header": moduleHeader,
    "no-fixed-delay": noFixedDelay,
    "no-sql-text": noSqlText,
    "predicate-name": predicateName,
    "standalone-test-name": standaloneTestName,
  },
});
