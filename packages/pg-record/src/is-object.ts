// Telling an object from anything else, for the values pg-record reads without knowing their type (errors, env bindings).

/** Whether `value` is an object, one a WeakMap can key. */
export const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null;
