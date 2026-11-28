// Which names a scope can't take, and what each clashes with, for a plain scope and an enum's.

/**
 * What a scope named `name` would clash with, or undefined: a Function method, which every class
 * has and the scope would hide (`bind`, `call`), or, as `isTaken` decides, a Relation method or a
 * Model static. `isTaken` is the caller's, since the command checks against the app's own library.
 */
export function scopeNameClash(
  name: string,
  isTaken: (name: string) => boolean,
): string | undefined {
  if (name in Function.prototype) return "a Function method";
  if (isTaken(name)) return "a Relation method or a Model static";
  return undefined;
}
