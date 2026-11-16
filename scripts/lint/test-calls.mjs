// Telling a test's or a suite's call (`test("…")`, `test.skip("…")`, `test.each(table)("…")`) by the function its chain starts from, for the repo's lint rules.

/** For each kind of link in a call's chain, the node it goes on from, toward the chain's start. */
const chainLinks = {
  MemberExpression: (node) => node.object,
  CallExpression: (node) => node.callee,
  TaggedTemplateExpression: (node) => node.tag,
};

/**
 * The function a call's chain starts from: `test` in `test("…")`, `test.skip("…")`,
 * `test.each(table)("…")`, and `test.each` followed by a tagged template table.
 */
export function chainRoot(callee) {
  let node = callee;
  while (Object.hasOwn(chainLinks, node.type)) node = chainLinks[node.type](node);
  return node.type === "Identifier" ? node.name : undefined;
}
