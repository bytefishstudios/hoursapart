import { localMinutesOfDay, localWeekday, zonedDateTimeToInstant, zonedParts } from './zone';

/**
 * One person in the team, described entirely in their own local terms.
 *
 * Working hours are local wall-clock minutes, which is the whole difficulty:
 * "9am to 5pm in Berlin" is a different UTC window in January than in July, and
 * the two shifts do not happen on the same weekend as the US ones. So
 * availability has to be evaluated per instant rather than computed once as a
 * fixed UTC range.
 */
export interface Participant {
  id: string;
  label: string;
  /** IANA identifier, e.g. `Australia/Sydney`. */
  timeZone: string;
  /** Minutes since local midnight, inclusive. */
  workStart: number;
  /** Minutes since local midnight, exclusive. May be <= workStart for night shifts. */
  workEnd: number;
  /** Local weekdays worked. 0 = Sunday. Defaults to Monday-Friday. */
  workDays?: number[];
}

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];
export const DEFAULT_WORK_START = 9 * 60;
export const DEFAULT_WORK_END = 17 * 60;

/** A contiguous run of time and who could attend during it. */
export interface Window {
  start: Date;
  end: Date;
  /** Participant ids available for the whole run. */
  availableIds: string[];
  /** `true` when every participant is available. */
  everyone: boolean;
}

export interface Slot {
  start: Date;
  availableIds: string[];
}

function worksToday(participant: Participant, weekday: number): boolean {
  const days = participant.workDays ?? DEFAULT_WORK_DAYS;
  return days.includes(weekday);
}

/**
 * Is this person inside working hours at this instant?
 *
 * Night shifts (workEnd <= workStart) wrap past midnight, and the weekday test
 * uses the day the shift *started* so a Friday 22:00-06:00 shift is not treated
 * as Saturday work.
 */
export function isAvailable(participant: Participant, instant: Date): boolean {
  const minutes = localMinutesOfDay(instant, participant.timeZone);
  const weekday = localWeekday(instant, participant.timeZone);
  const { workStart, workEnd } = participant;

  if (workEnd > workStart) {
    return worksToday(participant, weekday) && minutes >= workStart && minutes < workEnd;
  }

  // Overnight shift.
  if (minutes >= workStart) {
    return worksToday(participant, weekday);
  }
  if (minutes < workEnd) {
    // Still the previous local day's shift.
    return worksToday(participant, (weekday + 6) % 7);
  }
  return false;
}

/**
 * Sample availability across a UTC range.
 *
 * A day in UTC is not a day for the team: someone in Auckland and someone in
 * Los Angeles never share a UTC calendar date during business hours. The
 * default window spans two days so overlaps that straddle midnight UTC are not
 * cut in half.
 */
export function sampleAvailability(
  participants: Participant[],
  from: Date,
  hours = 48,
  stepMinutes = 15,
): Slot[] {
  const slots: Slot[] = [];
  const steps = Math.floor((hours * 60) / stepMinutes);

  for (let i = 0; i < steps; i += 1) {
    const start = new Date(from.getTime() + i * stepMinutes * 60_000);
    const availableIds = participants.filter((p) => isAvailable(p, start)).map((p) => p.id);
    slots.push({ start, availableIds });
  }

  return slots;
}

/** Collapse equal-availability slots into contiguous windows. */
export function toWindows(slots: Slot[], total: number, stepMinutes = 15): Window[] {
  const windows: Window[] = [];
  let current: Window | null = null;

  const key = (ids: string[]) => [...ids].sort().join(',');

  for (const slot of slots) {
    const slotEnd = new Date(slot.start.getTime() + stepMinutes * 60_000);

    if (current && key(current.availableIds) === key(slot.availableIds)) {
      current.end = slotEnd;
      continue;
    }

    if (current) windows.push(current);
    current = {
      start: slot.start,
      end: slotEnd,
      availableIds: slot.availableIds,
      everyone: slot.availableIds.length === total && total > 0,
    };
  }

  if (current) windows.push(current);
  return windows;
}

/**
 * Windows where the whole team is available, longest first.
 *
 * Returns an empty array when no such window exists, which is a real and common
 * answer for teams spanning more than about ten hours of longitude. Saying so
 * plainly is more useful than surfacing a near miss as if it worked.
 */
export function findFullOverlaps(
  participants: Participant[],
  from: Date,
  hours = 48,
  stepMinutes = 15,
): Window[] {
  if (participants.length === 0) return [];
  const slots = sampleAvailability(participants, from, hours, stepMinutes);
  return toWindows(slots, participants.length, stepMinutes)
    .filter((w) => w.everyone)
    .sort((a, b) => b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime()));
}

/** Duration of a window in minutes. */
export function windowMinutes(w: Window): number {
  return Math.round((w.end.getTime() - w.start.getTime()) / 60_000);
}

export interface MeetingCandidate {
  at: Date;
  baseMinutes: number;
  availableIds: string[];
  everyone: boolean;
  /** False when this wall-clock time does not exist because clocks jump forward. */
  valid: boolean;
}

/**
 * Resolve a wall-clock start on a date, rejecting spring-forward times that do
 * not exist. Repeated autumn times use the deterministic occurrence selected
 * by `zonedDateTimeToInstant`; availability and export therefore share exactly
 * the same instant.
 */
export function resolveMeetingStart(
  isoDate: string,
  timeZone: string,
  minutesOfDay: number,
): Date | null {
  const instant = zonedDateTimeToInstant(isoDate, timeZone, minutesOfDay);
  const actual = zonedParts(instant, timeZone);
  const [year, month, day] = isoDate.split('-').map(Number);
  return actual.year === year &&
    actual.month === month &&
    actual.day === day &&
    actual.hour * 60 + actual.minute === minutesOfDay
    ? instant
    : null;
}

/** Availability for the full elapsed meeting, sampled at the planner's resolution. */
export function isAvailableForMeeting(
  participant: Participant,
  meetingAt: Date,
  durationMinutes: number,
  stepMinutes = 30,
): boolean {
  for (let elapsed = 0; elapsed < durationMinutes; elapsed += stepMinutes) {
    if (!isAvailable(participant, new Date(meetingAt.getTime() + elapsed * 60_000))) return false;
  }
  return true;
}

/**
 * Build wall-clock candidates for one local day. Each candidate is resolved
 * once and then reused for availability and selection, avoiding DST drift.
 */
export function meetingCandidates(
  participants: Participant[],
  isoDate: string,
  anchorZone: string,
  durationMinutes: number,
  count = 48,
  stepMinutes = 30,
): MeetingCandidate[] {
  return Array.from({ length: count }, (_, index) => {
    const baseMinutes = index * stepMinutes;
    const resolved = resolveMeetingStart(isoDate, anchorZone, baseMinutes);
    const at = resolved ?? zonedDateTimeToInstant(isoDate, anchorZone, baseMinutes);
    const availableIds = resolved
      ? participants
          .filter((participant) =>
            isAvailableForMeeting(participant, resolved, durationMinutes, stepMinutes),
          )
          .map((participant) => participant.id)
      : [];
    return {
      at,
      baseMinutes,
      availableIds,
      everyone: availableIds.length === participants.length && participants.length > 0,
      valid: resolved !== null,
    };
  });
}
