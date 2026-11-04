// The tests' base class for the DB database's Models, as an app's `ApplicationRecord`, with a
// method, a scope and a callback every Model shares (#232).
import { Model, sql } from "../../../packages/active-record/src/index.ts";
import { schema } from "../DB.ts";

/** Each record saved, by its class's name, as the base class's callback saw it. */
export const saved: string[] = [];

export abstract class DbRecord extends Model {
  static override schema = schema;

  static newest = this.scope((q) => q.order(sql`id DESC`));

  static {
    this.afterSave((record) => void saved.push(record.constructor.name));
  }

  label(): string {
    return `${this.constructor.name} ${String(this.attributes().id)}`;
  }
}
