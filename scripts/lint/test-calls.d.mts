// The test-calls helpers' types, for the rules that import them.
export function chainRoot(callee: unknown): string | undefined;
export function isExpect(call: { callee: unknown }): boolean;
export function testName(call: { callee: unknown; arguments: unknown[] }): string | undefined;
