// Walking a class's prototype chain: what inherited declarations and table names read.
/** A class and every class (and object) it extends, nearest first. */
export function ancestors(model: object): object[] {
  const chain: object[] = [];
  for (
    let current: object | null = model;
    current !== null;
    current = Object.getPrototypeOf(current)
  ) {
    chain.push(current);
  }
  return chain;
}

/**
 * How `model`, or the nearest class it extends below `root`, declares the static `name`: its
 * property descriptor, read without calling a getter, or undefined when none does.
 */
export function staticBelow(
  model: object,
  root: object,
  name: string,
): PropertyDescriptor | undefined {
  for (const each of ancestors(model)) {
    if (each === root) return undefined;
    const declared = Object.getOwnPropertyDescriptor(each, name);
    if (declared !== undefined) return declared;
  }
  return undefined;
}
