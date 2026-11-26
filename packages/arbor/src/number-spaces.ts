// The spaces read around a number's digits in text (#590): ASCII whitespace only, as Postgres and SQLite read them.

/**
 * ASCII whitespace, as a regular expression's character class. JavaScript's `\s` would also read a
 * no-break space or an em space, which neither database reads around a number, so a condition
 * and a link would disagree on such text.
 */
export const asciiSpace = String.raw`[ \t\n\v\f\r]`;
