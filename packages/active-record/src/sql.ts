// The `sql` tagged template, `column()` and its typed values, and an upsert's `incoming()`: the only way raw SQL enters a query (ADR-0006), and their refusal outside a fragment (#539).
/**
 * A SQL fragment built with the `sql` tagged template (ADR-0006). The template
 * text is written by the developer; every interpolated value is bound as a
 * parameter and never becomes SQL text.
 */
export class SafeSql {
  readonly strings: readonly string[];
  readonly values: readonly unknown[];

  /** @internal Use the `sql` tag instead. */
  constructor(strings: readonly string[], values: readonly unknown[]) {
    this.strings = strings;
    this.values = values;
  }
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]): SafeSql {
  return new SafeSql([...strings], values);
}

/** A reference to an attribute's column, resolved against the query's Model when compiled. */
export class ColumnReference {
  readonly attribute: string;

  /** @internal Use `column()` instead. */
  constructor(attribute: string) {
    this.attribute = attribute;
  }

  /**
   * A value of this attribute for a fragment, converted as the attribute stores it: a `Date`
   * as the integer of an attribute kept as a Unix time, a boolean as 0 or 1, and so on. It's
   * still a bound parameter. Without it, a value has no attribute to say how it's stored (#142).
   */
  value(value: unknown): ColumnValue {
    return new ColumnValue(this.attribute, value);
  }
}

/** A value of an attribute, from `column(attribute).value(value)`, converted when compiled. */
export class ColumnValue {
  readonly attribute: string;
  /** What was given, before it's cast as an assigned value of the attribute. */
  readonly assigned: unknown;

  /** @internal Use `column(attribute).value(value)` instead. */
  constructor(attribute: string, assigned: unknown) {
    this.attribute = attribute;
    this.assigned = assigned;
  }
}

/**
 * The value a row an upsert writes has for an attribute, in its `onDuplicate` (#531): what the
 * row that clashed would have been given.
 */
export class IncomingReference {
  readonly attribute: string;

  /** @internal Use `incoming()` instead. */
  constructor(attribute: string) {
    this.attribute = attribute;
  }
}

/**
 * Whether a fragment's interpolated value names an attribute: a column, a typed value, or an
 * incoming value.
 */
export function isAttributeReference(
  value: unknown,
): value is ColumnReference | ColumnValue | IncomingReference {
  return (
    value instanceof ColumnReference ||
    value instanceof ColumnValue ||
    value instanceof IncomingReference
  );
}

/** What a fragment's reference given as a plain value is, for its refusal, or undefined. */
function referenceKind(value: unknown): string | undefined {
  if (value instanceof ColumnValue) return "a typed value";
  if (isAttributeReference(value)) return "a column() or incoming() reference";
  return undefined;
}

/**
 * Throws `TypeError` for a fragment's reference given as a value where a fragment could be
 * (an upsert's `onDuplicate`, #531; conditions and `updateAll`, #539): a typed value, which is
 * given as the value itself, or a column or incoming value, which only a fragment reads. Where
 * no fragment can be (`find`'s ids, #546), `takesFragment` is false, and only the value can be given.
 */
export function refuseReferenceValue(value: unknown, gives: string, takesFragment = true): void {
  const kind = referenceKind(value);
  if (kind === undefined) return;
  const remedy =
    value instanceof ColumnValue || !takesFragment
      ? "give the value itself"
      : "write it in an sql`…` fragment";
  throw new TypeError(`${gives} ${kind}; ${remedy}`);
}

/**
 * Throws `TypeError` for a fragment's reference assigned to a record or a written row's
 * attribute, where no fragment can be (#539): only the value itself can be written there.
 */
export function refuseAssignedReference(owner: string, attribute: string, value: unknown): void {
  const kind = referenceKind(value);
  if (kind === undefined) return;
  throw new TypeError(`${owner} "${attribute}" was given ${kind}; give the value itself`);
}

/** Names the column of `attribute` inside an `sql` fragment, quoted and mapped (ADR-0004). */
export function column(attribute: string): ColumnReference {
  return new ColumnReference(attribute);
}

/** What `incoming(attribute)` anywhere but an upsert's `onDuplicate` throws (#531). */
export function incomingRefusal(attribute: string): TypeError {
  return new TypeError(
    `incoming("${attribute}") names the value of a row an upsert writes, so only an upsert's onDuplicate can use it`,
  );
}

/**
 * Names, inside an upsert's `onDuplicate` fragment, the value the row being written has for
 * `attribute`, where `column(attribute)` names the clashing row's (#531).
 */
export function incoming(attribute: string): IncomingReference {
  return new IncomingReference(attribute);
}

/** A fragment's reference found inside a json value, at `path` from its top (#547). */
export class NestedReference extends Error {
  readonly path: string;
  readonly reference: unknown;

  constructor(path: string, reference: unknown) {
    super(`a reference at ${path}`);
    this.path = path;
    this.reference = reference;
  }

  /** `name` followed by the reference's path: `settings.a.0`. */
  under(name: string): string {
    return this.path === "" ? name : `${name}.${this.path}`;
  }
}

/**
 * A json value's JSON text, or undefined where JSON gives none. A `column()`, typed value or
 * `incoming()` anywhere in it throws `NestedReference`, as JSON would write its fields (#547). The
 * check is part of the `stringify` that writes the value, so it costs no walk of its own.
 */
export function jsonText(value: unknown): string | undefined {
  const paths = new WeakMap<object, string>();
  return JSON.stringify(value, function (this: object, key: string, inner: unknown) {
    const parent = paths.get(this);
    const path = parent === undefined ? "" : parent === "" ? key : `${parent}.${key}`;
    if (referenceKind(inner) !== undefined) throw new NestedReference(path, inner);
    if (typeof inner === "object" && inner !== null) paths.set(inner, path);
    return inner;
  });
}

/**
 * Throws `TypeError` for a fragment's reference nested in a condition's json value, as
 * `refuseReferenceValue` does for one given as the value (#547).
 */
export function refuseNestedReference(value: unknown, gives: string): void {
  try {
    jsonText(value);
  } catch (error) {
    if (error instanceof NestedReference) refuseReferenceValue(error.reference, error.under(gives));
  }
}
