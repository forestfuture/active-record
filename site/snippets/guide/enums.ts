import { Model } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";

// #region declare
export class Ticket extends ApplicationRecord {
  static override attributes = {
    status: { enum: ["open", "in_progress", "closed"] }, // stored as the names
    priority: { enum: { low: 0, normal: 1, high: 2 } }, // stored as 0, 1, and 2
  } as const;
}
// #endregion declare

export async function closeFirstUrgent() {
  // #region methods
  const ticket = await Ticket.high().notClosed().first();

  if (ticket?.isOpen()) {
    await ticket.saveAsClosed();
  }
  // #endregion methods
}

// #region generated-on
export class Task extends ApplicationRecord {
  static override attributes = { state: { enum: true } } as const;
}

// task.isDone(), task.saveAsDone(), Task.open()
// #endregion generated-on

// #region values
const priorities = Ticket.enumValues("priority"); // { low: 0, normal: 1, high: 2 }
// #endregion values

// #region affixes
export class Conversation extends Model.define({
  id: "integer",
  status: { type: "string", enum: ["active", "archived"], prefix: true },
  comments: { type: "string", enum: ["active", "closed"], suffix: true },
}) {}

// conversation.isStatusActive(), Conversation.activeComments()
// #endregion affixes

// #region validate
export class Survey extends Model.define({
  id: "integer",
  answer: { type: "string", enum: ["yes", "no"], validate: true },
}) {}
// #endregion validate

export { priorities };
