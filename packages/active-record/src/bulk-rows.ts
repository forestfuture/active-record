// A bulk write's rows as the values that bind them: JSON values within the database's cap on one value, and a row too large for one bound value by value (#392).
import { attributeFor } from "./attribute.ts";
import { hexOf } from "./binary-values.ts";
import { FILTERED, Filtered, isFiltered } from "./filtering.ts";
import type { ModelClass } from "./model.ts";

/**
 * Some of a bulk write's rows, in order: `json`, several bound as one JSON value the dialect
 * reads them from, or `row`, one whose JSON alone would pass the cap, its values bound apart.
 */
export type RowGroup = { json: unknown } | { row: readonly unknown[] };

/** A row's values, its JSON text, and what listeners see of that text. */
interface JsonRow {
  values: readonly unknown[];
  text: string;
  shown: string;
}

/**
 * `rows` of `names`' values, assigned, in groups whose JSON value is at most `maxBytes` long in
 * UTF-8 (all in one when it's undefined); listeners see a filtered attribute as "[FILTERED]".
 */
export function rowGroups(
  model: ModelClass,
  names: readonly string[],
  rows: readonly (readonly unknown[])[],
  maxBytes?: number,
): RowGroup[] {
  const jsonRows = rows.map(jsonRowOf(model, names));
  if (maxBytes === undefined) return [{ json: jsonValue(jsonRows) }];
  const groups: RowGroup[] = [];
  let pending: JsonRow[] = [];
  let bytes = 0; // The pending rows' JSON value, "[" and the rows joined by ",", without its "]".
  const flush = () => {
    if (pending.length > 0) groups.push({ json: jsonValue(pending) });
    pending = [];
  };
  for (const row of jsonRows) {
    const size = utf8Length(row.text);
    if (size + 2 > maxBytes) {
      flush();
      groups.push({ row: row.values });
      continue;
    }
    if (pending.length > 0 && bytes + 1 + size + 1 > maxBytes) flush();
    bytes = pending.length === 0 ? 1 + size : bytes + 1 + size;
    pending.push(row);
  }
  flush();
  return groups;
}

/** Writes a row of `names`' values as JSON, and as listeners see it. */
function jsonRowOf(model: ModelClass, names: readonly string[]) {
  const attributes = names.map((name) => attributeFor(model, name));
  const filtered = names.map((name) => isFiltered(model, name));
  const hiding = filtered.includes(true);
  return (values: readonly unknown[]): JsonRow => {
    const stored = values.map((value, index) => inJson(attributes[index]!.store(value)));
    const text = JSON.stringify(stored);
    if (!hiding) return { values, text, shown: text };
    const shown = JSON.stringify(stored.map((cell, index) => (filtered[index] ? FILTERED : cell)));
    return { values, text, shown };
  };
}

/** Rows as one JSON value, which listeners see with filtered attributes hidden. */
function jsonValue(rows: readonly JsonRow[]): unknown {
  const json = `[${rows.map(({ text }) => text).join(",")}]`;
  if (rows.every(({ text, shown }) => text === shown)) return json;
  return new Filtered(json, `[${rows.map(({ shown }) => shown).join(",")}]`);
}

/**
 * `text`'s length in UTF-8 bytes, counted without encoding a copy of it. A code unit below
 * U+0080 is one byte, below U+0800 two, and any other three, except that a surrogate pair is four
 * between its two units. JSON text has no lone surrogates: `JSON.stringify` escapes them.
 */
function utf8Length(text: string): number {
  let bytes = text.length;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) continue;
    bytes += unit < 0x800 || (unit >= 0xd800 && unit <= 0xdfff) ? 1 : 2;
  }
  return bytes;
}

/** A stored cell as a bulk write's JSON holds it: bytes as hex text, which JSON has no form for (#20). */
function inJson(cell: unknown): unknown {
  return cell instanceof Uint8Array ? hexOf(cell) : cell;
}
