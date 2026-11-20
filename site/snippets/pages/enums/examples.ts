import { Conversation } from "./src/models/conversation";
import { Survey } from "./src/models/survey";
import { Task } from "./src/models/task";
import { Ticket } from "./src/models/ticket";

export async function closingUrgent() {
  // #region methods
  const ticket = await Ticket.high().notClosed().first();
  if (ticket?.isOpen()) await ticket.saveAsClosed();

  const unfinished = await Ticket.where({ status: ["open", "in_progress"] }).count();
  // #endregion methods
  return { ticket, unfinished };
}

export function listingValues() {
  // #region values
  const priorities = Ticket.enumValues("priority"); // { low: 0, normal: 1, high: 2 }
  // #endregion values
  return priorities;
}

export async function prefixing() {
  // #region affixes
  const conversation = await Conversation.activeComments().firstOrThrow();
  const live = conversation.isStatusActive();
  // #endregion affixes
  return live;
}

export async function validating() {
  // #region validate
  const survey = Survey.build(JSON.parse('{ "answer": "maybe" }'));
  await survey.save(); // false
  console.log(survey.errors.fullMessages()); // ["Answer is not included in the list"]
  // #endregion validate
  return survey;
}

export async function finishing() {
  // #region generated-on
  const task = await Task.open().firstOrThrow();
  await task.saveAsDone(); // task.isDone() is now true
  // #endregion generated-on
  return task;
}
