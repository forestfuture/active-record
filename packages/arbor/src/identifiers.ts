// JavaScript identifiers and reserved words: which names code can declare, the generated schema's included.

/** Whether a name can be written bare: as a `const`, or as an object key without quotes. */
export function isIdentifier(name: string): boolean {
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name);
}

/** Words JavaScript doesn't allow as a declaration's name in a module (strict mode). */
export const reservedWords: ReadonlySet<string> = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends " +
    "false finally for function if import in instanceof new null return super switch this throw " +
    "true try typeof var void while with yield let static implements interface package private " +
    "protected public await arguments eval"
  ).split(" "),
);
