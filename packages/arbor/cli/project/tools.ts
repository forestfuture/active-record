// Another tool's (Drizzle, Prisma) files and SQL markers: which tool wrote a project's migrations.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Migration } from "./migrations.ts";

const tools = ["Drizzle", "Prisma"] as const;

export type Tool = (typeof tools)[number];

/** Each tool's files in a project, and the marker it writes into its SQL. */
const signs: Record<Tool, { files: readonly string[]; marker: RegExp }> = {
  Drizzle: {
    files: ["ts", "mts", "cts", "js", "mjs", "cjs", "json"].map((ext) => `drizzle.config.${ext}`),
    marker: /^--> statement-breakpoint/m,
  },
  Prisma: {
    files: ["prisma/schema.prisma", "schema.prisma", "prisma.config.ts"],
    marker: /^-- CreateTable$/m,
  },
};

/**
 * The folders a tool's config may be in: the project's, and each above it up to the repository's
 * root (a monorepo keeps it there), or just the project's outside a repository.
 */
function searchedFolders(projectDir: string): string[] {
  const folders = [projectDir];
  for (let dir = projectDir; !existsSync(join(dir, ".git")); dir = dirname(dir)) {
    if (dirname(dir) === dir) return [projectDir];
    folders.push(dirname(dir));
  }
  return folders;
}

/** The tools whose files are in the project or above it (`drizzle.config.ts`, `prisma/schema.prisma`). */
export function toolsWithFiles(projectDir: string): Tool[] {
  const folders = searchedFolders(projectDir);
  return tools.filter((tool) =>
    folders.some((folder) => signs[tool].files.some((file) => existsSync(join(folder, file)))),
  );
}

/**
 * The tool that wrote a project's migrations, if one is recognised: by its files (`toolsFound`,
 * from `toolsWithFiles`), or its marker in a migration.
 */
export function migrationTool(
  toolsFound: readonly Tool[],
  migrations: readonly Migration[],
): Tool | undefined {
  return tools.find(
    (tool) =>
      toolsFound.includes(tool) ||
      migrations.some((migration) => signs[tool].marker.test(migration.sql)),
  );
}
