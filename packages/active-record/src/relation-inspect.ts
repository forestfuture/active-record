// How a Relation prints: its Model and the SELECT it would send, which printing never sends (#104).
import type { CompiledSql } from "./compiler.ts";
import { Filtered } from "./filtering.ts";
import { FilteredMark, printed, type InspectArgs } from "./inspect-support.ts";

/** `Relation<Model> { sql, params }`, filtered params as `[FILTERED]`; `[Relation]` past `depth`. */
export function inspectRelation(
  modelName: string,
  { sql, params }: CompiledSql,
  args: InspectArgs,
): string {
  const body = () => ({
    sql,
    params: params.map((param) => (param instanceof Filtered ? new FilteredMark(false) : param)),
  });
  return printed(`Relation<${modelName}>`, "Relation", body, args);
}
