// The `sql` tagged template, `column()` and its typed values: the only way raw SQL enters a query (ADR-0006).
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

/** Whether a fragment's interpolated value names an attribute: a column, or a typed value. */
export function namesAttribute(value: unknown): value is ColumnReference | ColumnValue {
  return value instanceof ColumnReference || value instanceof ColumnValue;
}

/** Names the column of `attribute` inside an `sql` fragment, quoted and mapped (ADR-0004). */
export function column(attribute: string): ColumnReference {
  return new ColumnReference(attribute);
}
