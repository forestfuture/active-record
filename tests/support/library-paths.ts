// The library's packages, as a test project's tsconfig.json `paths`: each name at its source in this repo.
const source = (path: string) => [new URL(`../../packages/${path}`, import.meta.url).pathname];

export const libraryPaths = {
  "@forestfuture/active-record": source("active-record/src/index.ts"),
  "@forestfuture/active-record/adapter": source("active-record/src/for-adapters.ts"),
  "@forestfuture/active-record/cli": source("active-record/cli/for-adapters.ts"),
  "@forestfuture/d1-record": source("d1-record/src/index.ts"),
  "@forestfuture/d1-record/cli": source("d1-record/cli/plugin.ts"),
};
