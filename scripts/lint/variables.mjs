// Finding the variable an identifier names, from the scope it's read in, for the repo's lint rules.

/** The variable `identifier` names, from the innermost scope it's declared in. */
export function variableOf(scope, identifier) {
  for (let at = scope; at !== null; at = at.upper) {
    const variable = at.set.get(identifier.name);
    if (variable !== undefined) return variable;
  }
  return undefined;
}
