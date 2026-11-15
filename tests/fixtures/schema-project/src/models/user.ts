import { ApplicationRecord } from "./application-record";

export class User extends ApplicationRecord {
  static override attributes = { role: { enum: ["member", "editor"] } } as const;
}
