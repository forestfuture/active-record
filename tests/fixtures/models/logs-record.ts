// The base class for the LOGS database's Models, holding its own schema (#232).
import { Model } from "../../../packages/active-record/src/index.ts";
import { schema } from "../LOGS.ts";

export abstract class LogsRecord extends Model {
  static override schema = schema;
}
