import { sql } from "../../packages/active-record/src/index.ts";

/** An `sql` fragment from its text pieces and values, so a test can vary the text between them. */
export function fragment(strings: string[], ...values: unknown[]) {
  return sql(Object.assign([...strings], { raw: strings }) as TemplateStringsArray, ...values);
}
