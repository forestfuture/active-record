// Writing values safely into generated TypeScript source.
/**
 * Text as a string literal in generated TypeScript, quotes and backslashes escaped: for values
 * that come from a project's config or paths (#85).
 */
export function stringLiteral(text: string): string {
  return JSON.stringify(text);
}

/** A double-quoted string literal in generated source, read back: `stringLiteral`'s pattern. */
export const stringLiteralPattern = String.raw`"(?:[^"\\]|\\.)*"`;
