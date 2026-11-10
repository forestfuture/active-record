// Adding entries to the `databases` of a JSON-with-comments file's text, keeping the rest as written: its comments, layout and trailing commas (#301).

/** A token of the text outside comments and whitespace: a string, or any other run of a character. */
interface Token {
  start: number;
  end: number;
  /** A string's contents, or the character itself. */
  value: string;
  string: boolean;
}

/** Just past the comment starting at `index`, or `index` when none starts there. */
function pastComment(text: string, index: number): number {
  if (text.startsWith("//", index)) {
    const end = text.indexOf("\n", index);
    return end < 0 ? text.length : end;
  }
  if (text.startsWith("/*", index)) {
    const end = text.indexOf("*/", index + 2);
    return end < 0 ? text.length : end + 2;
  }
  return index;
}

/** Just past the string starting at `start`. */
function pastString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
  return index + 1;
}

/** The text's tokens, in order: strings, and each other character that isn't space or a comment. */
function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const comment = pastComment(text, index);
    if (comment > index) index = comment;
    else if (/\s/.test(text[index]!)) index += 1;
    else if (text[index] === '"') {
      const end = pastString(text, index);
      tokens.push({
        start: index,
        end,
        value: JSON.parse(text.slice(index, end)) as string,
        string: true,
      });
      index = end;
    } else {
      tokens.push({ start: index, end: index + 1, value: text[index]!, string: false });
      index += 1;
    }
  }
  return tokens;
}

/** How a token changes the depth of nesting: an opening bracket 1, a closing one -1. */
function depthChange({ value, string }: Token): number {
  if (string) return 0;
  if (value === "{" || value === "[") return 1;
  return value === "}" || value === "]" ? -1 : 0;
}

/** The index of the token that closes the object or array opened at `open`. */
function closing(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index++) {
    depth += depthChange(tokens[index]!);
    if (depth === 0) return index;
  }
  return tokens.length - 1;
}

/** Whether the tokens at `index` are the key `databases`, then `:` and an object's `{`. */
function isDatabasesKey(tokens: readonly Token[], index: number): boolean {
  const key = tokens[index]!;
  return (
    key.string &&
    key.value === "databases" &&
    tokens[index + 1]?.value === ":" &&
    tokens[index + 2]?.value === "{"
  );
}

/** The indexes of the top-level `databases` object's `{` and `}`, if the text has one. */
function databasesObject(tokens: readonly Token[]): { open: number; close: number } | undefined {
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    depth += depthChange(tokens[index]!);
    if (depth === 1 && isDatabasesKey(tokens, index)) {
      return { open: index + 2, close: closing(tokens, index + 2) };
    }
  }
  return undefined;
}

/** The whitespace a line starts with, for the line holding `at`. */
function indentAt(text: string, at: number): string {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))![0];
}

/** Just past the end of `at`'s line when only space and a `//` comment follow it there, or `at`. */
function endOfLine(text: string, at: number): number {
  const end = text.indexOf("\n", at);
  const rest = text.slice(at, end < 0 ? text.length : end);
  return /^\s*(\/\/.*)?$/.test(rest) ? (end < 0 ? text.length : end) : at;
}

/**
 * The text with `entries` added at the end of its top-level `databases` object, each on a line of
 * its own, as the entries before it are indented, with a trailing comma if the last one had one;
 * undefined when the text has no such object with an entry in it.
 */
export function withEntries(
  text: string,
  entries: readonly (readonly [string, Record<string, unknown>])[],
): string | undefined {
  const tokens = tokensOf(text);
  const object = databasesObject(tokens);
  if (object === undefined || object.close - object.open < 2) return undefined;
  const last = tokens[object.close - 1]!;
  const trailing = last.value === "," && !last.string;
  const indent = indentAt(text, tokens[object.open + 1]!.start);
  const lines = entries.map(([key, value]) => {
    const fields = Object.entries(value).map(
      ([name, field]) => `${JSON.stringify(name)}: ${JSON.stringify(field)}`,
    );
    return `\n${indent}${JSON.stringify(key)}: { ${fields.join(", ")} }`;
  });
  const after = endOfLine(text, last.end);
  const added = trailing ? lines.map((line) => `${line},`).join("") : lines.join(",");
  return `${text.slice(0, last.end)}${trailing ? "" : ","}${text.slice(last.end, after)}${added}${text.slice(after)}`;
}
