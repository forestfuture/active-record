// Telling a test's or a suite's call (`test("…")`, `test.skip("…")`, `test.each(table)("…")`) by the function its chain starts from, an assertion's (`expect(…)`), and reading a test's name, for the repo's lint rules.

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

/** Whether `call` is a call of Vitest's `expect`, or its `expect.soft`, which start an assertion. */
export function isExpect({ callee }) {
  const key = callee.computed ? callee.property?.value : callee.property?.name;
  const expect = callee.type === "MemberExpression" && key === "soft" ? callee.object : callee;
  return expect.type === "Identifier" && expect.name === "expect";
}

/** The functions that take a test's or a suite's name. */
const testFunctions = new Set(["test", "it", "describe"]);

/** The text of a name given as a string or a template literal, with `${…}` for each value. */
function nameText(node) {
  if (node?.type === "TemplateLiteral") return node.quasis.map((q) => q.value.cooked).join("${…}");
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}

/** The name a test's or a suite's call gives, or undefined for another call or a computed name. */
export function testName(call) {
  return testFunctions.has(chainRoot(call.callee)) ? nameText(call.arguments[0]) : undefined;
}
