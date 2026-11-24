// The console's own commands (`reload`, `verbose`), and the listener that shows statements (#104).
import type { ConsoleProject } from "./project.ts";
import type { SessionCommand } from "./session.ts";
import { statementLine, type StatementEvent } from "./verbose.ts";

export interface CommandsOptions {
  /** Whether statements print, to begin with. */
  verbose: boolean;
  /** Where a statement's line goes: the console's own output. */
  write: (line: string) => void;
  /** Dim a statement's line, as on a terminal. */
  dim: boolean;
}

/**
 * The commands, and the `onQuery` the console's database is connected with. They share one
 * switch: `.verbose` flips what the listener does.
 */
export function consoleCommands(
  project: ConsoleProject,
  { verbose, write, dim }: CommandsOptions,
): { commands: Record<string, SessionCommand>; onQuery: (event: StatementEvent) => void } {
  let showing = verbose;
  return {
    onQuery: (event) => {
      if (showing) write(statementLine(event, dim));
    },
    commands: {
      verbose: {
        help: "Show the SQL each line runs: .verbose, .verbose on, or .verbose off (also: verbose!)",
        bang: true,
        run: (argument) => {
          const word = argument.trim().toLowerCase();
          if (word !== "" && word !== "on" && word !== "off") {
            return "Use .verbose, .verbose on, or .verbose off";
          }
          showing = word === "" ? !showing : word === "on";
          return `SQL logging ${showing ? "on" : "off"}`;
        },
      },
      reload: {
        help: "Read your Models again, after editing them (also: reload!)",
        bang: true,
        run: async (_argument, scope) => {
          const before = Object.keys(project.models);
          const again = await project.reload();
          if (typeof again === "string") return again;
          for (const name of before) delete scope[name];
          Object.assign(scope, again);
          return `Reloaded: ${Object.keys(again).join(", ")}`;
        },
      },
    },
  };
}
