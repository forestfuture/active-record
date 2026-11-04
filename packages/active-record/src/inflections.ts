// English pluralization and singularization, so tables are named as Rails names them.
// Ported from Active Support's default inflections
// (activesupport/lib/active_support/inflections.rb).

type Rule = readonly [RegExp, string];

/** Words whose plural no rule makes: singular, then plural. */
const IRREGULARS: readonly (readonly [string, string])[] = [
  ["person", "people"],
  ["man", "men"],
  ["child", "children"],
  ["sex", "sexes"],
  ["move", "moves"],
  ["zombie", "zombies"],
];

/** Plural rules in Rails' order of definition. The last one that matches wins, as in Rails. */
const PLURALS: readonly Rule[] = [
  [/$/, "s"],
  [/s$/i, "s"],
  [/^(ax|test)is$/i, "$1es"],
  [/(octop|vir)us$/i, "$1i"],
  [/(octop|vir)i$/i, "$1i"],
  [/(alias|status)$/i, "$1es"],
  [/(bu)s$/i, "$1ses"],
  [/(buffal|tomat)o$/i, "$1oes"],
  [/([ti])um$/i, "$1a"],
  [/([ti])a$/i, "$1a"],
  [/sis$/i, "ses"],
  [/(?:([^f])fe|([lr])f)$/i, "$1$2ves"],
  [/(hive)$/i, "$1s"],
  [/([^aeiouy]|qu)y$/i, "$1ies"],
  [/(x|ch|ss|sh)$/i, "$1es"],
  [/(matr|vert|ind)(?:ix|ex)$/i, "$1ices"],
  [/^(m|l)ouse$/i, "$1ice"],
  [/^(m|l)ice$/i, "$1ice"],
  [/^(ox)$/i, "$1en"],
  [/^(oxen)$/i, "$1"],
  [/(quiz)$/i, "$1zes"],
  ...IRREGULARS.flatMap(([singular, plural]) => irregular(singular, plural, plural)),
];

/** Singular rules, likewise in Rails' order. */
const SINGULARS: readonly Rule[] = [
  [/s$/i, ""],
  [/(ss)$/i, "$1"],
  [/(n)ews$/i, "$1ews"],
  [/([ti])a$/i, "$1um"],
  [/((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)(sis|ses)$/i, "$1sis"],
  [/(^analy)(sis|ses)$/i, "$1sis"],
  [/([^f])ves$/i, "$1fe"],
  [/(hive)s$/i, "$1"],
  [/(tive)s$/i, "$1"],
  [/([lr])ves$/i, "$1f"],
  [/([^aeiouy]|qu)ies$/i, "$1y"],
  [/(s)eries$/i, "$1eries"],
  [/(m)ovies$/i, "$1ovie"],
  [/(x|ch|ss|sh)es$/i, "$1"],
  [/^(m|l)ice$/i, "$1ouse"],
  [/(bus)(es)?$/i, "$1"],
  [/(o)es$/i, "$1"],
  [/(shoe)s$/i, "$1"],
  [/(cris|test)(is|es)$/i, "$1is"],
  [/^(a)x[ie]s$/i, "$1xis"],
  [/(octop|vir)(us|i)$/i, "$1us"],
  [/(alias|status)(es)?$/i, "$1"],
  [/^(ox)en/i, "$1"],
  [/(vert|ind)ices$/i, "$1ex"],
  [/(matr)ices$/i, "$1ix"],
  [/(quiz)zes$/i, "$1"],
  [/(database)s$/i, "$1"],
  ...IRREGULARS.flatMap(([singular, plural]) => irregular(singular, plural, singular)),
];

/** Words with no plural, matched as the last word (Rails' `\b<word>\z`). */
const UNCOUNTABLE =
  /\b(?:equipment|information|rice|money|species|series|fish|sheep|jeans|police)$/i;

/**
 * Rails' `irregular`: rules turning either form into `into` (the plural for plural rules, the
 * singular for singular ones), keeping the first letter's case.
 */
function irregular(singular: string, plural: string, into: string): Rule[] {
  return [
    [new RegExp(`(${singular[0]})${singular.slice(1)}$`, "i"), `$1${into.slice(1)}`],
    [new RegExp(`(${plural[0]})${plural.slice(1)}$`, "i"), `$1${into.slice(1)}`],
  ];
}

/** Applies the last rule that matches, as Rails does; uncountable words stay as they are. */
function inflect(word: string, rules: readonly Rule[]): string {
  if (word === "" || UNCOUNTABLE.test(word)) return word;
  for (let index = rules.length - 1; index >= 0; index--) {
    const [pattern, replacement] = rules[index]!;
    if (pattern.test(word)) return word.replace(pattern, replacement);
  }
  return word;
}

/** Rails' `pluralize`: `category` → `categories`, `person` → `people`, `sheep` → `sheep`. */
export function pluralize(word: string): string {
  return inflect(word, PLURALS);
}

/** Rails' `singularize`: `categories` → `category`, `people` → `person`, `line_items` → `line_item`. */
export function singularize(word: string): string {
  return inflect(word, SINGULARS);
}
