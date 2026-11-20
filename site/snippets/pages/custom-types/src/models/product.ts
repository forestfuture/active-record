import { money } from "../types/money";
import { ApplicationRecord } from "./application-record";

export class Product extends ApplicationRecord {
  static override attributes = {
    priceCents: money,
  } as const;
}
