// The repo's lint rule that example data uses everyday names, never a historical person's (#567), and the names it looks for, which the guide's check reads too.
import { defineRule } from "vite-plus/lint/plugins";
import { variableOf } from "./variables.mjs";

/**
 * Historical people's names that example data has used, or might reach for. Everyday first names
 * (Barbara, Margaret, Dennis, Ken, Tim) and words with another meaning (darwin, the macOS
 * platform; Tesla; Hamilton; Claude, as in CLAUDE.md) are left out.
 */
const names = [
  "ada",
  "grace",
  "linus",
  "alan",
  "turing",
  "lovelace",
  "hopper",
  "edsger",
  "dijkstra",
  "hedy",
  "lamarr",
  "babbage",
  "knuth",
  "liskov",
  "torvalds",
  "ritchie",
  "kernighan",
  "codd",
  "boole",
  "noether",
  "curie",
  "einstein",
  "newton",
];

/** Any of the names, whole: only a letter or a digit joins a word, so `ada_id` holds one. */
const namePattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.join("|")})(?![\\p{L}\\p{N}])`, "iu");

/** A lowercase letter followed by a capital: where a camel-case name's words meet (`adaPosts`). */
const camelCaseJoin = /(\p{Ll})(\p{Lu})/gu;

/** A capital followed by a capitalized word: where an acronym ends (`ADAUser`, `XMLHopper`). */
const acronymJoin = /(\p{Lu})(\p{Lu}\p{Ll})/gu;

/** The first historical name in `text`, as written there, or undefined for none. */
export function historicalName(text) {
  const words = text.replace(camelCaseJoin, "$1 $2").replace(acronymJoin, "$1 $2");
  return namePattern.exec(words)?.[0];
}

/** The text a node holds that the rule reads: a string's, a template's piece, or a name. */
const nodeText = {
  Literal: (node) => (typeof node.value === "string" ? node.value : undefined),
  TemplateElement: (node) => node.value.cooked ?? node.value.raw,
  Identifier: (node) => node.name,
};

export default defineRule({
  meta: {
    messages: {
      historical:
        'Example data uses everyday names (Jane, Sam), not a historical person\'s: drop "{{name}}", ' +
        "or opt out with a reason after `--`.",
    },
  },
  create(context) {
    /** Reports the node when its text holds a historical name. */
    function check(node) {
      const text = nodeText[node.type](node);
      const name = text === undefined ? undefined : historicalName(text);
      if (name !== undefined) context.report({ node, messageId: "historical", data: { name } });
    }

    /**
     * Whether `identifier` uses a variable the file declares, rather than declaring it: its
     * declaration is reported, so each use isn't too.
     */
    function isUse(identifier) {
      const variable = variableOf(context.sourceCode.getScope(identifier), identifier);
      if (variable === undefined || variable.identifiers.includes(identifier)) return false;
      return variable.references.some((reference) => reference.identifier === identifier);
    }

    /** Reports an identifier that declares a name, or isn't a variable's, such as a property. */
    function checkIdentifier(node) {
      if (!isUse(node)) check(node);
    }
    return { Literal: check, TemplateElement: check, Identifier: checkIdentifier };
  },
});
