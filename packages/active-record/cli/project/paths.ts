// A path as printed or imported: relative, forward slashes.
import { relative, sep } from "node:path";

/** A relative path with forward slashes, as migrations are named on every system. */
export function slashed(path: string): string {
  return path.split(sep).join("/");
}

/** A module path from one file's folder to another file, as an import writes it (`../db/schema`). */
export function importPath(fromDir: string, to: string): string {
  const path = slashed(relative(fromDir, to)).replace(/\.ts$/, "");
  return path.startsWith(".") ? path : `./${path}`;
}

/** A path as printed: relative to the project, with forward slashes. */
export function shown(cwd: string, path: string): string {
  return slashed(relative(cwd, path)) || ".";
}
