import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatMinutes,
  formatOffset,
  isValidIsoDate,
  localMinutesOfDay,
  offsetMinutes,
  toIsoDate,
  zonedDateTimeToInstant,
  zonedParts,
} from './zone';
import {
  DEFAULT_WORK_DAYS,
  findFullOverlaps,
  isAvailable,
  meetingCandidates,
  resolveMeetingStart,
  windowMinutes,
  type Participant,
} from './overlap';
import { findTransitions, projectMeeting, resolveLocalTime } from './dst';

/**
 * These tests lean on offset rules that are stable and externally verifiable
 * rather than on dates I have hardcoded:
 *
 *  - UK/EU shift at 01:00 UTC on the last Sunday of March and October.
 *  - Sydney shifts at 02:00 local on the first Sunday of October and April.
 *  - Tokyo and Kolkata have never observed daylight saving.
 *  - Adelaide and Kolkata sit on half-hour offsets.
 *
 * Asserting the *shape* of the answer keeps the suite meaningful even as the
 * platform's tzdata is updated underneath it.
 */

const person = (over: Partial<Participant> & { id: string; timeZone: string }): Participant => ({
  label: over.label ?? over.id,
  workStart: 9 * 60,
  workEnd: 17 * 60,
  workDays: DEFAULT_WORK_DAYS,
  ...over,
});

/** First Monday at 00:00 UTC on or after the given date, for deterministic scans. */
function nextMondayUtc(from: string): Date {
  const d = new Date(`${from}T00:00:00Z`);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

describe('zone offsets', () => {
  it('reads fixed-offset zones correctly all year', () => {
    for (const month of ['01', '04', '07', '10']) {
      const instant = new Date(`2026-${month}-15T04:00:00Z`);
      expect(offsetMinutes(instant, 'UTC'), `UTC ${month}`).toBe(0);
      expect(offsetMinutes(instant, 'Asia/Tokyo'), `Tokyo ${month}`).toBe(540);
      expect(offsetMinutes(instant, 'Asia/Kolkata'), `Kolkata ${month}`).toBe(330);
    }
  });

  it('handles half-hour and three-quarter-hour offsets', () => {
    const jan = new Date('2026-01-15T04:00:00Z');
    // Adelaide is +9:30 standard, +10:30 on daylight saving.
    expect([570, 630]).toContain(offsetMinutes(jan, 'Australia/Adelaide'));
    expect(offsetMinutes(jan, 'Asia/Kathmandu')).toBe(345);
  });

  it('tracks a southern-hemisphere zone across the year', () => {
    const jan = offsetMinutes(new Date('2026-01-15T00:00:00Z'), 'Australia/Sydney');
    const jul = offsetMinutes(new Date('2026-07-15T00:00:00Z'), 'Australia/Sydney');
    expect(jan).toBe(660); // AEDT
    expect(jul).toBe(600); // AEST
  });

  it('tracks a northern-hemisphere zone across the year', () => {
    const jan = offsetMinutes(new Date('2026-01-15T00:00:00Z'), 'Europe/London');
    const jul = offsetMinutes(new Date('2026-07-15T00:00:00Z'), 'Europe/London');
    expect(jan).toBe(0); // GMT
    expect(jul).toBe(60); // BST
  });

  it('never reports hour 24 for local midnight', () => {
    // Engines rendering midnight as "24" under hour12:false silently corrupts
    // day arithmetic, so this is pinned.
    for (let h = 0; h < 24; h += 1) {
      const parts = zonedParts(new Date(Date.UTC(2026, 5, 15, h)), 'Asia/Tokyo');
      expect(parts.hour).toBeGreaterThanOrEqual(0);
      expect(parts.hour).toBeLessThanOrEqual(23);
    }
  });

  it('formats offsets and times', () => {
    expect(formatOffset(660)).toBe('+11:00');
    expect(formatOffset(-300)).toBe('-05:00');
    expect(formatOffset(330)).toBe('+05:30');
    expect(formatOffset(0)).toBe('+00:00');
    expect(formatMinutes(9 * 60)).toBe('09:00');
    expect(formatMinutes(17 * 60 + 30)).toBe('17:30');
    expect(formatMinutes(0, true)).toBe('12:00am');
    expect(formatMinutes(13 * 60, true)).toBe('1:00pm');
  });
});

describe('DST transitions', () => {
  const from = new Date('2026-01-01T00:00:00Z');

  it('finds none for zones that do not observe daylight saving', () => {
    expect(findTransitions('Asia/Tokyo', from, 14)).toHaveLength(0);
    expect(findTransitions('Asia/Kolkata', from, 14)).toHaveLength(0);
    expect(findTransitions('UTC', from, 14)).toHaveLength(0);
  });

  it('finds London shifting at 01:00 UTC on a Sunday, an hour each way', () => {
    const transitions = findTransitions('Europe/London', from, 12);
    expect(transitions.length).toBeGreaterThanOrEqual(2);

    for (const t of transitions) {
      expect(t.at.getUTCHours(), `hour of ${t.at.toISOString()}`).toBe(1);
      expect(t.at.getUTCDay(), `weekday of ${t.at.toISOString()}`).toBe(0);
      expect(Math.abs(t.deltaMinutes)).toBe(60);
    }

    const spring = transitions.find((t) => t.deltaMinutes > 0)!;
    const autumn = transitions.find((t) => t.deltaMinutes < 0)!;
    expect(spring.at.getUTCMonth()).toBe(2); // March
    expect(autumn.at.getUTCMonth()).toBe(9); // October
    expect(spring.offsetBefore).toBe(0);
    expect(spring.offsetAfter).toBe(60);
  });

  it('finds Sydney shifting on a local Sunday between +10:00 and +11:00', () => {
    const transitions = findTransitions('Australia/Sydney', from, 12);
    expect(transitions.length).toBeGreaterThanOrEqual(2);

    for (const t of transitions) {
      expect(zonedParts(t.at, 'Australia/Sydney').weekday).toBe(0);
      expect(Math.abs(t.deltaMinutes)).toBe(60);
      expect([600, 660]).toContain(t.offsetBefore);
      expect([600, 660]).toContain(t.offsetAfter);
    }

    // Southern hemisphere: clocks go back in April, forward in October.
    expect(transitions.find((t) => t.deltaMinutes < 0)!.at.getUTCMonth()).toBe(3);
    expect(transitions.find((t) => t.deltaMinutes > 0)!.at.getUTCMonth()).toBe(9);
  });

  it('confirms the hemispheres do not shift together', () => {
    // The whole reason a global team breaks several times a year rather than twice.
    const london = findTransitions('Europe/London', from, 12).map((t) => t.at.getTime());
    const sydney = findTransitions('Australia/Sydney', from, 12).map((t) => t.at.getTime());
    for (const l of london) expect(sydney).not.toContain(l);
  });

  it('resolves the transition to the exact minute', () => {
    const [first] = findTransitions('Europe/London', from, 12);
    const justBefore = new Date(first.at.getTime() - 60_000);
    expect(offsetMinutes(justBefore, 'Europe/London')).toBe(first.offsetBefore);
    expect(offsetMinutes(first.at, 'Europe/London')).toBe(first.offsetAfter);
  });
});

describe('resolveLocalTime', () => {
  it('lands on the requested local wall-clock time', () => {
    for (const tz of ['Australia/Sydney', 'Europe/London', 'America/New_York', 'Asia/Kolkata']) {
      for (const month of ['01', '07']) {
        const near = new Date(`2026-${month}-15T00:00:00Z`);
        const at = resolveLocalTime(near, tz, 9 * 60);
        expect(localMinutesOfDay(at, tz), `${tz} ${month}`).toBe(9 * 60);
      }
    }
  });

  it('still lands correctly on a transition day', () => {
    const [spring] = findTransitions('Europe/London', new Date('2026-01-01T00:00:00Z'), 12);
    const at = resolveLocalTime(spring.at, 'Europe/London', 14 * 60);
    expect(localMinutesOfDay(at, 'Europe/London')).toBe(14 * 60);
  });
});

describe('meeting candidates on DST days', () => {
  it('rejects nonexistent spring-forward starts and keeps later starts aligned', () => {
    expect(resolveMeetingStart('2026-03-29', 'Europe/London', 90)).toBeNull();

    const london = person({
      id: 'london',
      timeZone: 'Europe/London',
      workStart: 0,
      workEnd: 180,
      workDays: [0],
    });
    const candidates = meetingCandidates([london], '2026-03-29', 'Europe/London', 120);
    expect(candidates[2].valid).toBe(false); // 01:00 does not occur.
    expect(candidates[3].valid).toBe(false); // 01:30 does not occur.
    expect(candidates[4].valid).toBe(true);
    expect(localMinutesOfDay(candidates[4].at, 'Europe/London')).toBe(120);
    // 00:30 + two elapsed hours reaches 03:30 after the jump, so a shift
    // ending at 03:00 cannot fit the whole meeting.
    expect(candidates[1].availableIds).toEqual([]);
  });

  it('uses one deterministic autumn occurrence for both grid and export', () => {
    const resolved = resolveMeetingStart('2026-10-25', 'Europe/London', 90);
    expect(resolved).not.toBeNull();
    const repeatedHour = meetingCandidates([], '2026-10-25', 'Europe/London', 60)[3];
    expect(repeatedHour.valid).toBe(true);
    expect(repeatedHour.at.toISOString()).toBe(resolved!.toISOString());
  });
});

describe('availability', () => {
  const sydney = person({ id: 'syd', timeZone: 'Australia/Sydney' });

  it('is inside working hours and outside them', () => {
    const at10 = resolveLocalTime(new Date('2026-06-15T00:00:00Z'), 'Australia/Sydney', 10 * 60);
    const at20 = resolveLocalTime(new Date('2026-06-15T00:00:00Z'), 'Australia/Sydney', 20 * 60);
    expect(isAvailable(sydney, at10)).toBe(true);
    expect(isAvailable(sydney, at20)).toBe(false);
  });

  it('excludes the weekend in the participant’s own local time', () => {
    let cursor = new Date('2026-06-15T00:00:00Z');
    // Walk forward to a local Saturday in Sydney.
    while (zonedParts(cursor, 'Australia/Sydney').weekday !== 6) {
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
    const saturdayMidday = resolveLocalTime(cursor, 'Australia/Sydney', 12 * 60);
    expect(isAvailable(sydney, saturdayMidday)).toBe(false);
  });

  it('handles an overnight shift wrapping past midnight', () => {
    const nightShift = person({
      id: 'night',
      timeZone: 'Asia/Tokyo',
      workStart: 22 * 60,
      workEnd: 6 * 60,
    });
    const base = new Date('2026-06-16T00:00:00Z'); // a Tuesday
    expect(isAvailable(nightShift, resolveLocalTime(base, 'Asia/Tokyo', 23 * 60))).toBe(true);
    expect(isAvailable(nightShift, resolveLocalTime(base, 'Asia/Tokyo', 2 * 60))).toBe(true);
    expect(isAvailable(nightShift, resolveLocalTime(base, 'Asia/Tokyo', 12 * 60))).toBe(false);
  });
});

describe('overlap windows', () => {
  const from = nextMondayUtc('2026-06-15');

  it('finds a real overlap between Sydney and Singapore', () => {
    const windows = findFullOverlaps(
      [
        person({ id: 'syd', timeZone: 'Australia/Sydney' }),
        person({ id: 'sg', timeZone: 'Asia/Singapore' }),
      ],
      from,
      48,
    );

    expect(windows.length).toBeGreaterThan(0);
    expect(windowMinutes(windows[0])).toBeGreaterThanOrEqual(120);
    expect(windows[0].everyone).toBe(true);
  });

  it('reports no overlap for Sydney and London on 9-to-5, which is the truth', () => {
    // Sydney 09:00-17:00 is 22:00-06:00 UTC; London 09:00-17:00 is 09:00-17:00
    // UTC in winter and 08:00-16:00 in summer. They never meet.
    for (const month of ['2026-01-12', '2026-06-15']) {
      const windows = findFullOverlaps(
        [
          person({ id: 'syd', timeZone: 'Australia/Sydney' }),
          person({ id: 'lon', timeZone: 'Europe/London' }),
        ],
        nextMondayUtc(month),
        48,
      );
      expect(windows, month).toHaveLength(0);
    }
  });

  it('returns nothing for an empty team rather than throwing', () => {
    expect(findFullOverlaps([], from, 48)).toHaveLength(0);
  });

  it('produces windows aligned to the sampling step', () => {
    const windows = findFullOverlaps(
      [person({ id: 'a', timeZone: 'UTC' }), person({ id: 'b', timeZone: 'UTC' })],
      from,
      48,
      15,
    );
    for (const w of windows) expect(windowMinutes(w) % 15).toBe(0);
  });
});

describe('recurring meeting projection', () => {
  const team = [
    person({ id: 'syd', label: 'Sydney', timeZone: 'Australia/Sydney' }),
    person({ id: 'lon', label: 'London', timeZone: 'Europe/London' }),
    person({ id: 'tyo', label: 'Tokyo', timeZone: 'Asia/Tokyo' }),
  ];

  it('holds the anchor participant’s local time fixed every week', () => {
    const { occurrences } = projectMeeting(
      team,
      'syd',
      9 * 60,
      new Date('2026-01-05T00:00:00Z'),
      60,
    );

    expect(occurrences).toHaveLength(60);
    for (const week of occurrences) {
      expect(week.times.find((t) => t.id === 'syd')!.minutes).toBe(9 * 60);
    }
  });

  it('detects the weeks where the meeting moves for other participants', () => {
    const { shifts } = projectMeeting(team, 'syd', 9 * 60, new Date('2026-01-05T00:00:00Z'), 60);

    // Sydney anchors, so Sydney never moves. London and Tokyo are affected by
    // Sydney's two shifts, and London by its own two.
    expect(shifts.length).toBeGreaterThanOrEqual(3);
    expect(shifts.every((s) => s.changes.length > 0)).toBe(true);
    expect(shifts.flatMap((s) => s.changes).some((c) => c.id === 'syd')).toBe(false);
  });

  it('moves a fixed-offset participant only when the anchor shifts', () => {
    const { shifts } = projectMeeting(
      [team[0], team[2]], // Sydney anchor + Tokyo, neither London nor its shifts
      'syd',
      9 * 60,
      new Date('2026-01-05T00:00:00Z'),
      60,
    );

    // Tokyo has no daylight saving, so it only appears to move when Sydney does:
    // twice in a year.
    const tokyoChanges = shifts.flatMap((s) => s.changes).filter((c) => c.id === 'tyo');
    expect(tokyoChanges).toHaveLength(2);
    for (const c of tokyoChanges) {
      expect(Math.abs(c.afterMinutes - c.beforeMinutes)).toBe(60);
    }
  });

  it('reports the local date shift when a meeting lands on another day', () => {
    const { occurrences } = projectMeeting(
      [
        person({ id: 'la', label: 'Los Angeles', timeZone: 'America/Los_Angeles' }),
        person({ id: 'akl', label: 'Auckland', timeZone: 'Pacific/Auckland' }),
      ],
      'la',
      15 * 60,
      new Date('2026-06-01T00:00:00Z'),
      4,
    );

    const auckland = occurrences[0].times.find((t) => t.id === 'akl')!;
    expect(auckland.dayShift).toBe(1);
  });

  it('returns empty when the anchor is not in the team', () => {
    const { occurrences, shifts } = projectMeeting(team, 'nope', 9 * 60, new Date(), 10);
    expect(occurrences).toHaveLength(0);
    expect(shifts).toHaveLength(0);
  });
});

describe('calendar dates', () => {
  it('reads the local date, which is not the UTC date', () => {
    // 23:30 UTC on 24 December is already Christmas Day in Sydney and still
    // Christmas Eve in Los Angeles.
    const instant = new Date('2026-12-24T23:30:00Z');
    expect(toIsoDate(instant, 'Australia/Sydney')).toBe('2026-12-25');
    expect(toIsoDate(instant, 'UTC')).toBe('2026-12-24');
    expect(toIsoDate(instant, 'America/Los_Angeles')).toBe('2026-12-24');
  });

  it('rejects malformed and impossible dates', () => {
    expect(isValidIsoDate('2026-12-25')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true); // leap year
    expect(isValidIsoDate('2027-02-29')).toBe(false); // not a leap year
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-00-10')).toBe(false);
    expect(isValidIsoDate('2026-1-1')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
  });

  it('steps across month, year and leap boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(daysBetween('2026-12-25', '2027-01-01')).toBe(7);
    expect(daysBetween('2027-01-01', '2026-12-25')).toBe(-7);
  });

  it('steps a whole day even across a daylight saving change', () => {
    // Sydney springs forward on the first Sunday of October. Stepping the
    // calendar must not land on the same day twice or skip one, which is what
    // adding 86_400_000 milliseconds to an instant would risk.
    expect(addDays('2026-10-03', 1)).toBe('2026-10-04');
    expect(addDays('2026-10-04', 1)).toBe('2026-10-05');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26'); // UK falls back
  });

  it('resolves a date and time in a zone to the right instant', () => {
    // Sydney is on +11:00 in late December, so local midnight is 13:00 UTC the
    // day before.
    const midnight = zonedDateTimeToInstant('2026-12-25', 'Australia/Sydney', 0);
    expect(offsetMinutes(midnight, 'Australia/Sydney')).toBe(660);
    expect(midnight.toISOString()).toBe('2026-12-24T13:00:00.000Z');
    expect(toIsoDate(midnight, 'Australia/Sydney')).toBe('2026-12-25');
    expect(localMinutesOfDay(midnight, 'Australia/Sydney')).toBe(0);
  });

  it('lands on the requested wall clock time in any zone', () => {
    for (const zone of [
      'UTC',
      'Asia/Kolkata',
      'Australia/Adelaide',
      'America/New_York',
      'Pacific/Auckland',
    ]) {
      for (const iso of ['2026-01-15', '2026-07-15']) {
        const at = zonedDateTimeToInstant(iso, zone, 9 * 60 + 30);
        expect(localMinutesOfDay(at, zone), `${zone} ${iso}`).toBe(9 * 60 + 30);
        expect(toIsoDate(at, zone), `${zone} ${iso}`).toBe(iso);
      }
    }
  });

  it('resolves the hour before and after a spring-forward without drifting a day', () => {
    // London jumps 01:00 -> 02:00 UTC on the last Sunday of March, so 02:30
    // local does not exist that day. Whatever we return must still be on the
    // right calendar day rather than silently rolling over.
    const gap = zonedDateTimeToInstant('2027-03-28', 'Europe/London', 90);
    expect(toIsoDate(gap, 'Europe/London')).toBe('2027-03-28');

    const before = zonedDateTimeToInstant('2027-03-28', 'Europe/London', 0);
    const after = zonedDateTimeToInstant('2027-03-28', 'Europe/London', 12 * 60);
    expect(offsetMinutes(before, 'Europe/London')).toBe(0);
    expect(offsetMinutes(after, 'Europe/London')).toBe(60);
  });

  it('resolves an ambiguous autumn hour to one of the two valid instants', () => {
    // 01:30 happens twice in London on the last Sunday of October. Either is
    // defensible; returning something an hour off is not.
    const at = zonedDateTimeToInstant('2026-10-25', 'Europe/London', 90);
    expect(localMinutesOfDay(at, 'Europe/London')).toBe(90);
    expect(toIsoDate(at, 'Europe/London')).toBe('2026-10-25');
  });
});
