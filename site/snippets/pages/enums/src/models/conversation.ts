import { ApplicationRecord } from "./application-record";

export class Conversation extends ApplicationRecord {
  static override attributes = {
    status: { enum: ["active", "archived"], prefix: true }, // isStatusActive()
    comments: { enum: ["active", "closed"], suffix: true }, // Conversation.activeComments()
  } as const;
}
