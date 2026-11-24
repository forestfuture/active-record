// The library's packages, as a test project's tsconfig.json `paths`: each name at its source in this repo.
const source = (path: string) => [new URL(`../../packages/${path}`, import.meta.url).pathname];

export const libraryPaths = {
  "@forestfuture/arbor": source("arbor/src/index.ts"),
  "@forestfuture/arbor/adapter": source("arbor/src/for-adapters.ts"),
  "@forestfuture/arbor/cli": source("arbor/cli/for-adapters.ts"),
  "@forestfuture/arbor/d1": source("arbor/src/adapters/d1/index.ts"),
};
