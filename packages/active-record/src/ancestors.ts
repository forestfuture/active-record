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
