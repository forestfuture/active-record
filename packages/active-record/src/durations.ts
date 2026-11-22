// How long a token lasts (#517): `{ minutes: 15 }`, a duration in seconds, minutes, hours or days,
// and the moment it ends.

/** A length of time: `{ minutes: 15 }`, `{ days: 1, hours: 12 }`. */
export interface Duration {
  readonly seconds?: number;
  readonly minutes?: number;
  readonly hours?: number;
  readonly days?: number;
}

const SECONDS: Record<keyof Duration, number> = {
  seconds: 1,
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60,
};

/** Whether `value` is a duration: one or more units, each a number that isn't negative. */
export function isDuration(value: unknown): value is Duration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value).filter(([, each]) => each !== undefined);
  return (
    entries.length > 0 &&
    entries.every(
      ([unit, each]) =>
        Object.hasOwn(SECONDS, unit) && typeof each === "number" && each >= 0 && isFinite(each),
    )
  );
}

/** The seconds a duration lasts; `TypeError`, after `where`, for one that isn't a duration. */
export function secondsOf(duration: Duration, where: string): number {
  if (!isDuration(duration)) {
    throw new TypeError(
      `${where} takes a duration such as { minutes: 15 }: seconds, minutes, hours or days, none negative`,
    );
  }
  return Object.entries(duration).reduce(
    (total, [unit, value]) =>
      total + SECONDS[unit as keyof Duration] * ((value as number | undefined) ?? 0),
    0,
  );
}

/** When a token made now, lasting `duration`, expires. */
export function expiryAfter(duration: Duration, where: string): Date {
  return new Date(Date.now() + secondsOf(duration, where) * 1000);
}
