import { ApplicationRecord } from "./application-record";

export class Task extends ApplicationRecord {
  static override attributes = { state: { enum: true } } as const;
}
