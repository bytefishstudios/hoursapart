import type { Participant } from './overlap';
import { localMinutesOfDay, offsetMinutes, zonedParts } from './zone';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export interface Transition {
  timeZone: string;
  /** First instant on the new offset, resolved to the minute. */
  at: Date;
  offsetBefore: number;
  offsetAfter: number;
  /** Positive when clocks move forward. */
  deltaMinutes: number;
}

/**
 * Upcoming UTC-offset changes for a zone.
 *
 * Found empirically rather than read from a table: sample the offset daily, and
 * when consecutive days disagree, bisect down to the minute. This works for
 * daylight saving, for permanent statutory changes, and for the one-off
 * political redefinitions that a hardcoded rule set would miss entirely.
 *
 * Zones without daylight saving simply return an empty array.
 */
export function findTransitions(timeZone: string, from: Date, monthsAhead = 14): Transition[] {
  const until = new Date(from.getTime());
  until.setUTCMonth(until.getUTCMonth() + monthsAhead);

  const transitions: Transition[] = [];
  let cursor = new Date(from.getTime());
  let previousOffset = offsetMinutes(cursor, timeZone);

  while (cursor.getTime() < until.getTime()) {
    const next = new Date(cursor.getTime() + DAY_MS);
    const nextOffset = offsetMinutes(next, timeZone);

    if (nextOffset !== previousOffset) {
      const at = bisectTransition(cursor, next, timeZone, previousOffset);
      transitions.push({
        timeZone,
        at,
        offsetBefore: previousOffset,
        offsetAfter: nextOffset,
        deltaMinutes: nextOffset - previousOffset,
      });
      previousOffset = nextOffset;
    }

    cursor = next;
  }

  return transitions;
}

/** Narrow a known offset change down to the minute it takes effect. */
function bisectTransition(low: Date, high: Date, timeZone: string, offsetBefore: number): Date {
  let lo = low.getTime();
  let hi = high.getTime();

  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (offsetMinutes(new Date(mid), timeZone) === offsetBefore) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // `hi` is the first sampled minute already on the new offset.
  return new Date(hi - (hi % 60_000));
}

export interface ParticipantTime {
  id: string;
  label: string;
  timeZone: string;
  /** Local minutes since midnight. */
  minutes: number;
  /** Local calendar date, for the cases where the meeting lands on another day. */
  date: string;
  /** Day difference relative to the anchor participant: -1, 0 or +1. */
  dayShift: number;
}

export interface MeetingWeek {
  /** UTC instant of the occurrence. */
  at: Date;
  times: ParticipantTime[];
}

export interface MeetingShift {
  /** The first occurrence on the new pattern. */
  from: Date;
  /** Participants whose local time moved, with old and new values. */
  changes: Array<{
    id: string;
    label: string;
    timeZone: string;
    beforeMinutes: number;
    afterMinutes: number;
  }>;
}

/**
 * Project a recurring meeting forward and find the weeks where it moves.
 *
 * A recurring call is almost always pinned to one person's local clock — the
 * organiser says "Tuesdays at 9am my time" — so the UTC instant is what drifts
 * when their zone shifts, and everyone else's local time drifts with it by a
 * different amount. Northern and southern hemispheres also change on different
 * weekends, so a global team gets several distinct breakages a year rather than
 * one tidy pair.
 *
 * This is the thing no existing tool tells you before it happens.
 */
export function projectMeeting(
  participants: Participant[],
  anchorId: string,
  anchorLocalMinutes: number,
  from: Date,
  weeks = 60,
): { occurrences: MeetingWeek[]; shifts: MeetingShift[] } {
  const anchor = participants.find((p) => p.id === anchorId);
  if (!anchor || participants.length === 0) return { occurrences: [], shifts: [] };

  const occurrences: MeetingWeek[] = [];
  let instant = resolveLocalTime(from, anchor.timeZone, anchorLocalMinutes);

  for (let week = 0; week < weeks; week += 1) {
    // Re-resolve each week so the anchor keeps its local wall-clock time even
    // as its own offset changes.
    const target = new Date(instant.getTime() + week * WEEK_MS);
    const at = resolveLocalTime(target, anchor.timeZone, anchorLocalMinutes);

    occurrences.push({
      at,
      times: participants.map((p) => describeFor(p, at, anchor.timeZone)),
    });
  }

  return { occurrences, shifts: diffOccurrences(occurrences) };
}

/**
 * The UTC instant at which `timeZone` reads `localMinutes` on the local day of
 * `nearInstant`.
 *
 * Two passes: guess using the offset at the reference instant, then correct
 * using the offset at the guess. That second pass matters precisely on
 * transition days, which is the case this whole module exists for.
 */
export function resolveLocalTime(nearInstant: Date, timeZone: string, localMinutes: number): Date {
  const parts = zonedParts(nearInstant, timeZone);
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    Math.floor(localMinutes / 60),
    localMinutes % 60,
  );

  let guess = new Date(wallAsUtc - offsetMinutes(nearInstant, timeZone) * 60_000);
  guess = new Date(wallAsUtc - offsetMinutes(guess, timeZone) * 60_000);

  return guess;
}

function describeFor(participant: Participant, at: Date, anchorZone: string): ParticipantTime {
  const local = zonedParts(at, participant.timeZone);
  const anchorLocal = zonedParts(at, anchorZone);

  const localDay = Date.UTC(local.year, local.month - 1, local.day);
  const anchorDay = Date.UTC(anchorLocal.year, anchorLocal.month - 1, anchorLocal.day);

  return {
    id: participant.id,
    label: participant.label,
    timeZone: participant.timeZone,
    minutes: localMinutesOfDay(at, participant.timeZone),
    date: `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`,
    dayShift: Math.round((localDay - anchorDay) / DAY_MS),
  };
}

/** Weeks where any participant's local time differs from the week before. */
function diffOccurrences(occurrences: MeetingWeek[]): MeetingShift[] {
  const shifts: MeetingShift[] = [];

  for (let i = 1; i < occurrences.length; i += 1) {
    const previous = occurrences[i - 1];
    const current = occurrences[i];
    const changes: MeetingShift['changes'] = [];

    for (const now of current.times) {
      const before = previous.times.find((t) => t.id === now.id);
      if (before && before.minutes !== now.minutes) {
        changes.push({
          id: now.id,
          label: now.label,
          timeZone: now.timeZone,
          beforeMinutes: before.minutes,
          afterMinutes: now.minutes,
        });
      }
    }

    if (changes.length > 0) shifts.push({ from: current.at, changes });
  }

  return shifts;
}
