import { ApplicationRecord } from "./application-record";

export class Ticket extends ApplicationRecord {
  static override attributes = {
    status: { enum: ["open", "in_progress", "closed"] }, // stored as the names
    priority: { enum: { low: 0, normal: 1, high: 2 } }, // stored as 0, 1, and 2
  } as const;
}
