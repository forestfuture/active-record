// Passing a value its type doesn't allow, for the conformance tests (#565).

/** `value` as any type, as JSON, a form, a query string or untyped code can send it. */
export const untyped = (value: unknown) => value as never;
