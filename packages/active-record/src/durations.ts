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

/** The seconds a duration lasts; `TypeError`, after `where`, for one that isn't a duration. */
export function secondsOf(duration: Duration, where: string): number {
  const entries = Object.entries(duration).filter(([, value]) => value !== undefined);
  const isDuration =
    entries.length > 0 &&
    entries.every(
      ([unit, value]) =>
        Object.hasOwn(SECONDS, unit) && typeof value === "number" && value >= 0 && isFinite(value),
    );
  if (!isDuration) {
    throw new TypeError(
      `${where} takes a duration such as { minutes: 15 }: seconds, minutes, hours or days, none negative`,
    );
  }
  return entries.reduce(
    (total, [unit, value]) => total + SECONDS[unit as keyof Duration] * value,
    0,
  );
}

/** When a token made now, lasting `duration`, expires. */
export function expiryAfter(duration: Duration, where: string): Date {
  return new Date(Date.now() + secondsOf(duration, where) * 1000);
}
