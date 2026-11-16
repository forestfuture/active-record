// Following an identifier to the variable it names and the value a `const` was declared with, for the repo's lint rules.

/** The variable `identifier` names, from the innermost scope it's declared in. */
export function variableOf(scope, identifier) {
  for (let at = scope; at !== null; at = at.upper) {
    const variable = at.set.get(identifier.name);
    if (variable !== undefined) return variable;
  }
  return undefined;
}

/**
 * The value a `const` was declared with, for one declared alone or destructured from a list:
 * `const user = …`, `const [user] = …`.
 */
export function constInit(variable) {
  const definitions = variable?.defs ?? [];
  if (definitions.length !== 1) return undefined;
  const [{ node, parent }] = definitions;
  if (node.type !== "VariableDeclarator" || parent?.kind !== "const") return undefined;
  return node.id.type === "Identifier" || node.id.type === "ArrayPattern" ? node.init : undefined;
}

/**
 * A function that reads what an identifier names, with `read(variable)`, in the scope it's read
 * in. Each variable is read once, so consts that name each other can't loop.
 */
export function followingOnce(context, read) {
  const followed = new Set();
  return (identifier) => {
    const variable = variableOf(context.sourceCode.getScope(identifier), identifier);
    if (variable === undefined || followed.has(variable)) return undefined;
    followed.add(variable);
    return read(variable);
  };
}
