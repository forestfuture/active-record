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

/** The longest a token may last: 10,000 years, well inside what a Date can hold from now. */
const MOST_SECONDS = 10_000 * 365 * SECONDS.days;

/**
 * Whether `value` is a duration: one or more units, each a number that isn't negative, lasting
 * at most 10,000 years in all.
 */
export function isDuration(value: unknown): value is Duration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value).filter(([, each]) => each !== undefined);
  const isEach = entries.every(
    ([unit, each]) => Object.hasOwn(SECONDS, unit) && typeof each === "number" && each >= 0,
  );
  return (
    entries.length > 0 && isEach && totalSeconds(entries as [string, number][]) <= MOST_SECONDS
  );
}

function totalSeconds(entries: readonly [string, number][]): number {
  return entries.reduce(
    (total, [unit, value]) => total + SECONDS[unit as keyof Duration] * value,
    0,
  );
}

/** The seconds a duration lasts; `TypeError`, after `where`, for one that isn't a duration. */
export function secondsOf(duration: Duration, where: string): number {
  if (!isDuration(duration)) {
    throw new TypeError(
      `${where} takes a duration such as { minutes: 15 }: seconds, minutes, hours or days, none negative, at most 10,000 years`,
    );
  }
  return totalSeconds(Object.entries(duration).filter(([, value]) => value !== undefined));
}

/** When a token made now, lasting `duration`, expires. */
export function expiryAfter(duration: Duration, where: string): Date {
  return new Date(Date.now() + secondsOf(duration, where) * 1000);
}
