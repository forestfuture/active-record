// The characters that read as a plain space, a line break or nothing at all, and where a text holds one (#605).

/**
 * An invisible character: any Unicode space but the ASCII one, a line or
 * paragraph separator, or a format character (zero-width characters, the
 * byte order mark, the soft hyphen, the bidirectional controls).
 */
const invisible = /(?! )[\p{Zs}\p{Zl}\p{Zp}\p{Cf}]/gu;

/** Every invisible character, in code point order. */
export const invisibleCharacters: readonly string[] = Array.from(
  { length: 0x110000 },
  (_, codePoint) => codePoint,
)
  .filter((codePoint) => codePoint < 0xd800 || codePoint > 0xdfff)
  .map((codePoint) => String.fromCodePoint(codePoint))
  .filter((character) => character.match(invisible) !== null);

/** A character's code point, written as U+00A0 is. */
export function codePointName(character: string): string {
  const hex = character.codePointAt(0)!.toString(16).toUpperCase();
  return `U+${hex.padStart(4, "0")}`;
}

/** Each invisible character in text, as `<line>:<column> U+XXXX`, counting from 1. */
export function findInvisibleCharacters(text: string): string[] {
  return text.split("\n").flatMap((line, index) =>
    [...line.matchAll(invisible)].map((match) => {
      // Array.from counts code points, where length counts UTF-16 code units.
      const column = Array.from(line.slice(0, match.index)).length + 1;
      return `${index + 1}:${column} ${codePointName(match[0])}`;
    }),
  );
}
