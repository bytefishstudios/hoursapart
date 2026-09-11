import {
  DEFAULT_WORK_DAYS,
  DEFAULT_WORK_END,
  DEFAULT_WORK_START,
  type Participant,
} from './overlap';
import { isValidIsoDate, isValidTimeZone } from './zone';
import { labelForTimeZone } from './cities';

/**
 * The URL *is* the product.
 *
 * Everything lives in the query string: no accounts, no database, no backend.
 * That is what lets someone paste the link into a group chat and have it work
 * for everyone who opens it, which is the only distribution mechanism this
 * category has that does not depend on ranking first in a search result.
 *
 *   ?p=Australia/Sydney-540-1020-12345|Europe/London-540-1020-12345&a=0&m=540
 *
 * Per participant, hyphen separated: zone - workStart - workEnd - workDays,
 * with an optional trailing custom label. Minutes since local midnight rather
 * than hours so half-hour starts survive a round trip.
 */

const SEP_PERSON = '|';
const SEP_FIELD = '-';

/**
 * Meetings are any multiple of the planner's 15-minute grid, from a quarter of
 * an hour to a twelve-hour workshop. A whitelist of four lengths could not
 * express 45 minutes or 2h30m, which are ordinary meeting lengths.
 */
export const MEETING_STEP_MINUTES = 15;
export const MIN_MEETING_MINUTES = 15;
export const MAX_MEETING_MINUTES = 720;

/** Quick picks offered in the UI. Not a limit — any valid length is accepted. */
export const MEETING_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

export type MeetingDuration = number;
export const DEFAULT_MEETING_DURATION: MeetingDuration = 60;

export function isMeetingDuration(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value % MEETING_STEP_MINUTES === 0 &&
    value >= MIN_MEETING_MINUTES &&
    value <= MAX_MEETING_MINUTES
  );
}

export interface Scenario {
  participants: Participant[];
  /** Index into `participants` whose local clock the meeting is pinned to. */
  anchorIndex: number;
  /** Proposed meeting time in the anchor's local minutes, if one was chosen. */
  meetingMinutes: number | null;
  /** Length of the proposed meeting. Restricted to the planner's 30-minute grid. */
  durationMinutes: MeetingDuration;
  /**
   * Calendar day being inspected, in the anchor's zone, as `YYYY-MM-DD`.
   *
   * `null` means today, and is deliberately left out of the URL. A shared clock
   * link should stay live rather than freeze on the day it was created; only a
   * date the user explicitly picked is worth pinning.
   */
  date: string | null;
}

export function encodeScenario(scenario: Scenario): string {
  const params = new URLSearchParams();

  params.set(
    'p',
    scenario.participants
      .map((p) => {
        const days = (p.workDays ?? DEFAULT_WORK_DAYS).join('');
        const fields = [p.timeZone, p.workStart, p.workEnd, days];
        // Only carry a label when it differs from what we would derive anyway.
        if (p.label && p.label !== labelForTimeZone(p.timeZone)) {
          fields.push(encodeURIComponent(p.label));
        }
        return fields.join(SEP_FIELD);
      })
      .join(SEP_PERSON),
  );

  if (scenario.anchorIndex > 0) params.set('a', String(scenario.anchorIndex));
  if (scenario.meetingMinutes !== null) params.set('m', String(scenario.meetingMinutes));
  if (scenario.durationMinutes !== DEFAULT_MEETING_DURATION) {
    params.set('l', String(scenario.durationMinutes));
  }
  if (scenario.date !== null) params.set('d', scenario.date);

  return params.toString();
}

/**
 * Parse a scenario, or return `null` when there is nothing usable.
 *
 * Malformed entries are dropped rather than thrown: a link that has been
 * mangled by an email client should still open a working tool rather than an
 * error page.
 */
export function decodeScenario(search: string): Scenario | null {
  const params = new URLSearchParams(search);
  const raw = params.get('p');
  if (!raw) return null;

  const participants: Participant[] = [];
  // New links use `|`, which is escaped inside custom labels before the whole
  // value enters URLSearchParams. The short-lived `~` format and original `_`
  // format remain readable for links already copied during development.
  const chunks = raw.includes(SEP_PERSON)
    ? raw.split(SEP_PERSON)
    : raw.includes('~')
      ? raw.split('~')
      : splitLegacyParticipants(raw);

  chunks.forEach((chunk, index) => {
    const parts = chunk.split(SEP_FIELD);
    const timeZone = parts[0];
    if (!timeZone || !isValidTimeZone(timeZone)) return;

    const workStart = clampMinutes(Number(parts[1]), DEFAULT_WORK_START);
    const workEnd = clampMinutes(Number(parts[2]), DEFAULT_WORK_END);
    const workDays = parseDays(parts[3]);

    let label = labelForTimeZone(timeZone);
    if (parts[4]) {
      try {
        label = decodeURIComponent(parts[4]).slice(0, 40) || label;
      } catch {
        // Leave the derived label in place on a bad escape sequence.
      }
    }

    participants.push({
      id: `p${index}`,
      label,
      timeZone,
      workStart,
      workEnd,
      workDays,
    });
  });

  if (participants.length === 0) return null;

  const anchorRaw = Number(params.get('a'));
  const anchorIndex =
    Number.isInteger(anchorRaw) && anchorRaw >= 0 && anchorRaw < participants.length
      ? anchorRaw
      : 0;

  const meetingRaw = params.get('m');
  const meetingParsed = meetingRaw === null ? null : Number(meetingRaw);
  const meetingMinutes =
    meetingParsed !== null &&
    Number.isFinite(meetingParsed) &&
    meetingParsed >= 0 &&
    meetingParsed < 1440
      ? Math.round(meetingParsed)
      : null;

  const durationRaw = Number(params.get('l'));
  const durationMinutes = isMeetingDuration(durationRaw) ? durationRaw : DEFAULT_MEETING_DURATION;

  const dateRaw = params.get('d');
  const date = dateRaw !== null && isValidIsoDate(dateRaw) ? dateRaw : null;

  return { participants, anchorIndex, meetingMinutes, durationMinutes, date };
}

function splitLegacyParticipants(raw: string): string[] {
  const boundaries = [0];
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== '_') continue;
    const remainder = raw.slice(index + 1);
    const fieldEnd = remainder.indexOf('-');
    if (fieldEnd > 0 && isValidTimeZone(remainder.slice(0, fieldEnd))) {
      boundaries.push(index + 1);
    }
  }
  return boundaries.map((start, index) => {
    const next = boundaries[index + 1];
    return raw.slice(start, next === undefined ? undefined : next - 1);
  });
}

function clampMinutes(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1440) return fallback;
  return Math.round(value);
}

function parseDays(raw: string | undefined): number[] {
  if (!raw) return DEFAULT_WORK_DAYS;
  const days = [...new Set(raw.split('').map(Number))].filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6,
  );
  return days.length > 0 ? days.sort() : DEFAULT_WORK_DAYS;
}

/** Absolute shareable URL for the current scenario. */
export function shareUrl(origin: string, pathname: string, scenario: Scenario): string {
  return `${origin}${pathname}?${encodeScenario(scenario)}`;
}
