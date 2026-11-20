import { sizes } from "../types/sizes";
import { ApplicationRecord } from "./application-record";

export class Shirt extends ApplicationRecord {
  static override attributes = {
    sizes: { type: sizes, default: () => [] },
  } as const;
}
