// `record.errors`: the validation failures a record collects.
import {
  humanAttributeName,
  messageOf,
  type ErrorEntry,
  type ErrorValues,
  type MessageSource,
} from "./error-messages.ts";
import { inspectCustom, printed, type Inspect, type InspectOptions } from "./inspect-support.ts";

/** One validation failure: which attribute (or `"base"`), what kind, and the message. */
export interface ValidationError {
  attribute: string;
  type: string;
  message: string;
  /** The values its message shows, such as `count`, when it has some; never the attribute's. */
  values?: ErrorValues;
}

/** @internal The library's key for emptying an errors collection. */
export const clearErrors = Symbol("clearErrors");

/** @internal The library's key for adding a failure it found, with an optional message to use as it is. */
export const addFailure = Symbol("addFailure");

/** @internal A failure the library found: its type, the values its message shows, and any message given. */
export type Failure = Pick<ErrorEntry, "type" | "message" | "form"> & {
  values?: ErrorValues;
};

/** A record's validation errors: `record.errors`. Cleared at the start of each validation run. */
export class Errors {
  #entries: ErrorEntry[] = [];
  readonly #source: MessageSource;

  /** @internal Made by the library for each record. */
  constructor(source: MessageSource) {
    this.#source = source;
  }

  /**
   * Adds an error with this message; `type` defaults to `"invalid"`. Use `"base"` for the
   * record as a whole.
   */
  add(attribute: string, message: string, options?: { type?: string }): void;
  /**
   * Adds an error of this type, whose message is looked up in `errorMessages` when it's read,
   * with `%{name}` filled in from the values given: `{ type: "tooShort", count: 3 }`.
   */
  add(attribute: string, error: { type: string } & ErrorValues): void;
  add(attribute: string, message: string | ErrorValues, options: { type?: string } = {}): void {
    if (typeof message === "string") {
      this.#entries.push({ attribute, type: options.type ?? "invalid", values: {}, message });
      return;
    }
    const { type, ...values } = message;
    if (typeof type !== "string") throw new TypeError("errors.add needs a message or a type");
    const entry = { attribute, type, values };
    messageOf(this.#source, entry); // throws when no class has a message for its type
    this.#entries.push(entry);
  }

  /** The messages for one attribute (always an array). */
  get(attribute: string): string[] {
    return this.#entries
      .filter((entry) => entry.attribute === attribute)
      .map((entry) => messageOf(this.#source, entry));
  }

  /** Every message with its attribute's human name first: "Email can't be blank". */
  fullMessages(): string[] {
    return this.#entries.map((entry) => {
      const message = messageOf(this.#source, entry);
      if (entry.attribute === "base") return message;
      return `${humanAttributeName(this.#source.model, entry.attribute)} ${message}`;
    });
  }

  /** Every error as `{ attribute, type, message }`, with its `values` when it has some (copies). */
  toArray(): ValidationError[] {
    return this.#entries.map((entry) => {
      const { attribute, type, values } = entry;
      const error = { attribute, type, message: messageOf(this.#source, entry) };
      return Object.keys(values).length === 0 ? error : { ...error, values: { ...values } };
    });
  }

  isEmpty(): boolean {
    return this.#entries.length === 0;
  }

  get size(): number {
    return this.#entries.length;
  }

  /** `Errors [ { attribute, type, message }, … ]`, so a console shows what `#entries` holds (#104). */
  [inspectCustom](depth: number, options: InspectOptions, inspect: Inspect): string {
    return printed("Errors", "Errors", () => this.toArray(), { depth, options, inspect });
  }

  /** @internal Adds an error the library found, such as a validator's, returning its message. */
  [addFailure](attribute: string, { values = {}, ...failure }: Failure): string {
    const entry = { attribute, values, ...failure };
    this.#entries.push(entry);
    return messageOf(this.#source, entry);
  }

  /** @internal Called at the start of each validation run. */
  [clearErrors](): void {
    this.#entries = [];
  }
}
