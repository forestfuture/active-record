// What printing a record and a Relation share: the inspector's types, its colors, and the filtered mark.
import { FILTERED } from "./filtering.ts";

/** What Node's `util.inspect` passes a custom inspector; `src/` doesn't import Node's types. */
export interface InspectOptions {
  depth?: number | null;
  /** Wraps text in the color for a kind of value, or returns it as is when colors are off. */
  stylize?: (text: string, style: "special") => string;
}
export type Inspect = (value: unknown, options?: InspectOptions) => string;

/** The three arguments the runtime passes an inspector. */
export interface InspectArgs {
  /** The levels left below this value, which already counts this value's own level. */
  depth: number;
  options: InspectOptions;
  inspect: Inspect;
}

/** Node and workerd call a value's inspector under this registered symbol. */
export const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

/** Text in the color of a special value, or plain when colors are off. */
function styled(options: InspectOptions, text: string): string {
  return options.stylize ? options.stylize(text, "special") : text;
}

/** A filtered value's stand-in: prints unquoted, so it isn't taken for a string, as a special value. */
export class FilteredMark {
  readonly #changed: boolean;

  constructor(changed: boolean) {
    this.#changed = changed;
  }

  [inspectCustom](_depth: number, options: InspectOptions): string {
    return styled(options, FILTERED) + (this.#changed ? " (changed)" : "");
  }
}

/**
 * `label` and the runtime's own `inspect` of `body`, which is built only when there is depth left;
 * otherwise `[name]`, as Node prints any class instance nested too deep.
 */
export function printed(
  label: string,
  name: string,
  body: () => unknown,
  { depth, options, inspect }: InspectArgs,
): string {
  if (depth < 0) return styled(options, `[${name}]`);
  return `${label} ${inspect(body(), { ...options, depth })}`;
}
