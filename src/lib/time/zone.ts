/**
 * Zoned time primitives.
 *
 * There is no timezone data in this project. The IANA database ships with the
 * platform and is reachable through `Intl`, which means the tzdata is always as
 * current as the user's browser and there is nothing for us to maintain or get
 * wrong. Governments change offsets and daylight saving dates with very little
 * notice, so a bundled tz dataset would be a permanent liability.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  /** 0 = Sunday, matching Date.prototype.getDay. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatterCache.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      // h23 rather than hour12:false. Some engines render midnight as hour 24
      // under hour12:false, which silently breaks day arithmetic.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, cached);
  }
  return cached;
}

/** Wall-clock reading in `timeZone` at the given instant. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }

  // Defensive: guard the hour-24 case even though hourCycle should prevent it.
  const hour = Number(lookup.hour) % 24;

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour,
    minute: Number(lookup.minute),
    second: Number(lookup.second),
    weekday: WEEKDAY_INDEX[lookup.weekday!] ?? 0,
  };
}

/**
 * Offset of `timeZone` from UTC at a given instant, in minutes.
 *
 * Positive east of Greenwich. Derived by reading the wall clock in the zone,
 * reinterpreting those components as if they were UTC, and taking the
 * difference from the true instant. This is offset *at an instant*, which is
 * the only meaningful form — a zone does not have one offset.
 */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // The formatter resolves to whole seconds, so compare against the instant
  // with its milliseconds stripped. Leaving them in skews the division and can
  // round to the wrong minute right on a transition boundary.
  const instantToSecond = instant.getTime() - instant.getMilliseconds();
  return Math.round((asIfUtc - instantToSecond) / 60_000);
}

/** Minutes elapsed since local midnight in `timeZone`. */
export function localMinutesOfDay(instant: Date, timeZone: string): number {
  const { hour, minute } = zonedParts(instant, timeZone);
  return hour * 60 + minute;
}

/** `0` = Sunday, in local time. */
export function localWeekday(instant: Date, timeZone: string): number {
  return zonedParts(instant, timeZone).weekday;
}

/** True when the platform recognises the zone identifier. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The viewer's own zone, for sensible defaults. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** `+10:30`, `-04:00`, `+00:00`. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

/** `9:00`, `17:30` from minutes since midnight. */
export function formatMinutes(minutesOfDay: number, hour12 = false): string {
  const total = ((minutesOfDay % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = String(total % 60).padStart(2, '0');
  if (!hour12) return `${String(h24).padStart(2, '0')}:${m}`;
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m}${suffix}`;
}

/** Midnight UTC on the calendar day of `instant`. */
export function startOfUtcDay(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

/* ------------------------------------------------------------------ dates */

/**
 * Calendar dates are handled as `YYYY-MM-DD` strings rather than `Date`
 * objects.
 *
 * A `Date` is an instant, and an instant is not a date: `new Date('2026-12-25')`
 * is midnight UTC, which is still 24 December in Los Angeles. Since the whole
 * point of this tool is that a date means different things in different places,
 * carrying the ambiguity around in the type would guarantee off-by-one-day bugs.
 * A string plus an explicit zone is unambiguous.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The local calendar date in `timeZone` at this instant. */
export function toIsoDate(instant: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(instant, timeZone);
  return formatIsoDate(year, month, day);
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** True for a well-formed date that actually exists, e.g. rejects 2026-02-30. */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Round-trip through UTC to reject the impossible combinations.
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Shift a date string by whole days, staying in the calendar domain. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return formatIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Whole days from `a` to `b`. Positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * The UTC instant at which `timeZone` reads `minutesOfDay` on `isoDate`.
 *
 * Two passes, because the offset we need to subtract depends on the instant we
 * are trying to find — on a transition day the offset before and after differ.
 *
 * Spring-forward gaps have no exact answer: 02:30 simply does not occur in
 * London on the last Sunday in March. The second pass lands on the equivalent
 * instant just after the jump, which is the same thing calendar software does.
 */
export function zonedDateTimeToInstant(isoDate: string, timeZone: string, minutesOfDay = 0): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, Math.floor(minutesOfDay / 60), minutesOfDay % 60);

  let guess = new Date(wallAsUtc - offsetMinutes(new Date(wallAsUtc), timeZone) * 60_000);
  guess = new Date(wallAsUtc - offsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/**
 * `Friday 25 December 2026`.
 *
 * en-GB rather than en, for day-month order. The month is spelled out so there
 * is no ambiguity for a US reader either way, and it matches the rest of the
 * copy on the site.
 */
export function formatIsoDateLong(isoDate: string, locale = 'en-GB'): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** `25 Dec 2026`. */
export function formatIsoDateShort(isoDate: string, locale = 'en-GB'): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
