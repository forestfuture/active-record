// Collects the full name of every conformance test without running one, for the allowed-differences check.
import { createVitest } from "vite-plus/test/node";

/**
 * The full names of the tests in the `conformance:d1` project, which is defined with or without a
 * database URL. Collecting reads the titles in the source, so a `test.each` title stays as written
 * (`"%s is %s"`): only a literal title can be listed.
 */
export async function conformanceTestNames(): Promise<string[]> {
  const vitest = await createVitest("test", {
    watch: false,
    run: true,
    project: ["conformance:d1"],
  });
  try {
    const { testModules } = await vitest.collect();
    return testModules.flatMap((module) =>
      [...module.children.allTests()].map(({ fullName }) => fullName),
    );
  } finally {
    await vitest.close();
  }
}
