import { ApplicationRecord } from "./application-record";

export class Survey extends ApplicationRecord {
  static override attributes = {
    answer: { enum: ["yes", "no"], validate: true }, // an inclusion error, not a TypeError
  } as const;
}
