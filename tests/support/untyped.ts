// A value the type it's passed as doesn't name, as one from a request or untyped code would arrive (#565).

/** Passes `value` where its type isn't allowed, as JSON, a form or a query string can. */
export const untyped = (value: unknown) => value as never;
