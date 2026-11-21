// Reading an opt-out comment (`// oxlint-disable-next-line <rules> -- <why>`): the rules it turns off and its reason, for the repo's lint rules.

/** A comment that turns rules off, and what follows the directive: the rules, then any reason. */
const directive = /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(\s.*)?$/s;

/** An opt-out's rule names and its reason, or null for a comment that isn't one. */
export function parseOptOut(text) {
  const match = directive.exec(text);
  if (match === null) return null;
  // Oxlint takes the reason from after the first `--`, spaced or not.
  const [rules, reason = ""] = (match[1] ?? "").split(/--(.*)/s);
  return { names: rules.split(/[\s,]+/).filter(Boolean), reason };
}
