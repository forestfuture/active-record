// The variables helpers' types, for the rules that import them.
export function constInit(variable: unknown): unknown;
export function followingOnce<T>(
  context: unknown,
  read: (variable: unknown) => T,
): (identifier: { name: string }) => T | undefined;
