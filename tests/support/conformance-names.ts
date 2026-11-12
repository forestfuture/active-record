// Collects the full name of every conformance test without running one, for the allowed-differences check.
import { createVitest } from "vite-plus/test/node";
import { fullName } from "../conformance/allowed-differences.ts";

/** The full names of the tests in the `conformance:d1` project, which is defined with or without a database URL. */
export async function conformanceTestNames(): Promise<string[]> {
  const vitest = await createVitest("test", {
    watch: false,
    run: true,
    project: ["conformance:d1"],
  });
  try {
    const { testModules } = await vitest.collect();
    return testModules.flatMap((module) =>
      [...module.children.allTests()].map(({ name, parent }) =>
        fullName({ name, suite: suiteOf(parent) }),
      ),
    );
  } finally {
    await vitest.close();
  }
}

interface Parent {
  type: string;
  name?: string;
  parent?: Parent;
}

function suiteOf(parent: Parent): { name: string; suite?: ReturnType<typeof suiteOf> } | undefined {
  if (parent.type !== "suite") return undefined;
  return { name: parent.name ?? "", suite: parent.parent && suiteOf(parent.parent) };
}
