import { findTransitions, type Transition } from './dst';
import { addDays, offsetMinutes, zonedDateTimeToInstant } from './zone';

/**
 * How far apart two zones are, and when that changes.
 *
 * The premise of every other converter is that two cities have *a* time
 * difference. They do not. London and Sydney are nine, ten or eleven hours
 * apart depending on the date, because the two countries change their clocks on
 * different weekends and in opposite directions. New York and London spend most
 * of the year five hours apart but drop to four for a single week in autumn and
 * two in spring.
 *
 * A tool that prints one number is wrong for several weeks a year without ever
 * saying so. This module produces the whole picture instead: the distinct gaps
 * and the exact dates each one applies.
 */

export interface OffsetSpan {
  /** First local date in zone A on this gap, `YYYY-MM-DD`. */
  from: string;
  /** Last local date on this gap, inclusive. */
  to: string;
  /** Minutes that zone B is ahead of zone A. Negative when B is behind. */
  gapMinutes: number;
  days: number;
}

export interface ZoneDifference {
  zoneA: string;
  zoneB: string;
  spans: OffsetSpan[];
  /** Every distinct gap in the window, ascending. */
  distinctGaps: number[];
  /** True when the gap is not constant, i.e. when a single number would lie. */
  varies: boolean;
  /** The gap on the first day of the window. */
  gapAtStart: number;
  /**
   * The briefest span, when the gap varies. These short windows are where
   * scheduling actually breaks, because nobody expects them.
   */
  shortestSpan: OffsetSpan | null;
}

/**
 * Day-by-day scan of the gap between two zones.
 *
 * Sampled at local noon in zone A. Midnight would sit close enough to a
 * transition instant to make the reading ambiguous on exactly the days that
 * matter most, and no real zone transitions at midday.
 */
export function offsetSpans(
  zoneA: string,
  zoneB: string,
  fromIso: string,
  days = 400,
): OffsetSpan[] {
  const spans: OffsetSpan[] = [];
  let date = fromIso;

  for (let i = 0; i < days; i += 1) {
    const at = zonedDateTimeToInstant(date, zoneA, 12 * 60);
    const gapMinutes = offsetMinutes(at, zoneB) - offsetMinutes(at, zoneA);

    const last = spans[spans.length - 1];
    if (last && last.gapMinutes === gapMinutes) {
      last.to = date;
      last.days += 1;
    } else {
      spans.push({ from: date, to: date, gapMinutes, days: 1 });
    }

    date = addDays(date, 1);
  }

  return spans;
}

export function describeDifference(
  zoneA: string,
  zoneB: string,
  fromIso: string,
  days = 400,
): ZoneDifference {
  const spans = offsetSpans(zoneA, zoneB, fromIso, days);
  const distinctGaps = [...new Set(spans.map((s) => s.gapMinutes))].sort((a, b) => a - b);

  // The first and last spans are clipped by the window rather than by a real
  // transition, so they are poor candidates for "the surprising short one".
  const interior = spans.slice(1, -1);
  const shortestSpan =
    interior.length > 0
      ? interior.reduce((min, s) => (s.days < min.days ? s : min), interior[0])
      : null;

  return {
    zoneA,
    zoneB,
    spans,
    distinctGaps,
    varies: distinctGaps.length > 1,
    gapAtStart: spans[0]?.gapMinutes ?? 0,
    shortestSpan,
  };
}

/** The gap between two zones on one specific date, in minutes. */
export function gapOnDate(zoneA: string, zoneB: string, isoDate: string): number {
  const at = zonedDateTimeToInstant(isoDate, zoneA, 12 * 60);
  return offsetMinutes(at, zoneB) - offsetMinutes(at, zoneA);
}

/**
 * Convert a wall-clock time in zone A to the reading in zone B on a given date.
 *
 * Returns the day carry as well, because a converter that says "8:00" without
 * saying "the next day" has given a wrong answer half the time.
 */
export function convertTime(
  isoDate: string,
  zoneA: string,
  minutesOfDay: number,
  zoneB: string,
): { minutes: number; dayShift: number } {
  const gap = gapOnDate(zoneA, zoneB, isoDate);
  const raw = minutesOfDay + gap;
  const dayShift = Math.floor(raw / 1440);
  return { minutes: ((raw % 1440) + 1440) % 1440, dayShift };
}

/* --------------------------------------------------------- per-zone profile */

export interface DstProfile {
  timeZone: string;
  observesDst: boolean;
  /** Distinct offsets seen in the window, ascending. */
  offsets: number[];
  /** The offset in force for the greater part of the year. */
  standardOffset: number;
  /** The daylight saving offset, when there is one. */
  dstOffset: number | null;
  transitions: Transition[];
  nextTransition: Transition | null;
}

/**
 * Whether a zone shifts at all, and when next.
 *
 * Derived by sampling rather than by consulting a rule table, so a country that
 * abolishes daylight saving — as several have recently — is reflected as soon as
 * the platform's tzdata is updated, with no change here.
 */
export function dstProfile(timeZone: string, from: Date, monthsAhead = 14): DstProfile {
  const transitions = findTransitions(timeZone, from, monthsAhead);
  const startOffset = offsetMinutes(from, timeZone);

  const offsets = [...new Set([startOffset, ...transitions.map((t) => t.offsetAfter)])].sort(
    (a, b) => a - b,
  );

  const observesDst = offsets.length > 1;
  // Standard time is the lower offset; daylight saving moves clocks forward.
  const standardOffset = observesDst ? offsets[0] : startOffset;
  const dstOffset = observesDst ? offsets[offsets.length - 1] : null;

  return {
    timeZone,
    observesDst,
    offsets,
    standardOffset,
    dstOffset,
    transitions,
    nextTransition: transitions[0] ?? null,
  };
}

/* ------------------------------------------------------------- formatting */

/** `9 hours`, `30 minutes`, `5 hours 30 minutes`. */
export function formatGapDuration(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${m} minutes`;
  const hours = `${h} ${h === 1 ? 'hour' : 'hours'}`;
  return m === 0 ? hours : `${hours} ${m} minutes`;
}

/** `9 hours ahead`, `4 hours 30 minutes behind`, `the same time`. */
export function formatGap(minutes: number): string {
  if (minutes === 0) return 'the same time';
  return `${formatGapDuration(minutes)} ${minutes > 0 ? 'ahead' : 'behind'}`;
}

/** Compact signed form for tables: `+9:00`, `-4:30`, `0`. */
export function formatGapShort(minutes: number): string {
  if (minutes === 0) return '0';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const sign = minutes > 0 ? '+' : '\u2212';
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h${String(m).padStart(2, '0')}`;
}
