import {
  convertTime,
  describeDifference,
  dstProfile,
  formatGap,
  formatGapShort,
  gapOnDate,
  offsetSpans,
} from './difference';

/**
 * The claims these tests pin down are the ones the pair pages assert in prose,
 * so they need to be true rather than merely plausible.
 *
 * Externally checkable rules behind them:
 *  - UK clocks change on the last Sunday of March and October.
 *  - Sydney changes on the first Sunday of October and April.
 *  - Japan, India and Queensland have no daylight saving at all.
 */

const FROM = '2026-08-01';

describe('London and Sydney are not "a" fixed distance apart', () => {
  const d = describeDifference('Europe/London', 'Australia/Sydney', FROM, 400);

  it('has three distinct gaps across a year, not one', () => {
    expect(d.varies).toBe(true);
    expect(d.distinctGaps).toEqual([540, 600, 660]); // 9h, 10h, 11h
  });

  it('changes four times, because the two countries move on different weekends', () => {
    // Five spans means four transitions inside the window.
    expect(d.spans).toHaveLength(5);
    expect(d.spans.map((s) => s.gapMinutes)).toEqual([540, 600, 660, 600, 540]);
  });

  it('puts the changes on the dates the two governments actually use', () => {
    expect(d.spans.map((s) => s.from)).toEqual([
      '2026-08-01', // window start, not a transition
      '2026-10-04', // Sydney springs forward, first Sunday of October
      '2026-10-25', // London falls back, last Sunday of October
      '2027-03-28', // London springs forward, last Sunday of March
      '2027-04-04', // Sydney falls back, first Sunday of April
    ]);
  });

  it('agrees with a direct single-date query', () => {
    expect(gapOnDate('Europe/London', 'Australia/Sydney', '2026-09-15')).toBe(540);
    expect(gapOnDate('Europe/London', 'Australia/Sydney', '2026-10-10')).toBe(600);
    expect(gapOnDate('Europe/London', 'Australia/Sydney', '2026-12-25')).toBe(660);
  });

  it('is antisymmetric', () => {
    for (const date of ['2026-09-15', '2026-10-10', '2026-12-25']) {
      expect(gapOnDate('Australia/Sydney', 'Europe/London', date)).toBe(
        -gapOnDate('Europe/London', 'Australia/Sydney', date),
      );
    }
  });
});

describe('the short windows nobody expects', () => {
  it('finds the single week when New York is four hours behind London, not five', () => {
    const d = describeDifference('Europe/London', 'America/New_York', FROM, 400);
    expect(d.distinctGaps).toEqual([-300, -240]); // 5h behind, 4h behind

    const fourHourSpans = d.spans.filter((s) => s.gapMinutes === -240);
    expect(fourHourSpans).toHaveLength(2);

    // Autumn: the UK falls back a week before the US does.
    expect(fourHourSpans[0].from).toBe('2026-10-25');
    expect(fourHourSpans[0].days).toBe(7);

    // Spring: the US springs forward two weeks before the UK.
    expect(fourHourSpans[1].from).toBe('2027-03-14');
    expect(fourHourSpans[1].days).toBe(14);
  });

  it('reports the shortest interior span, which is where scheduling breaks', () => {
    const d = describeDifference('Europe/London', 'America/New_York', FROM, 400);
    expect(d.shortestSpan?.days).toBe(7);
    expect(d.shortestSpan?.gapMinutes).toBe(-240);
  });
});

describe('a zone with no daylight saving still moves relative to one that has it', () => {
  it('shifts Tokyo against London even though Japan never changes its clocks', () => {
    const d = describeDifference('Europe/London', 'Asia/Tokyo', FROM, 400);
    expect(d.varies).toBe(true);
    expect(d.distinctGaps).toEqual([480, 540]); // 8h, 9h

    const tokyo = dstProfile('Asia/Tokyo', new Date(`${FROM}T00:00:00Z`));
    expect(tokyo.observesDst).toBe(false);
    expect(tokyo.transitions).toHaveLength(0);
    expect(tokyo.standardOffset).toBe(540);
    expect(tokyo.dstOffset).toBeNull();
  });

  it('keeps two non-shifting zones at a genuinely constant distance', () => {
    const d = describeDifference('Asia/Tokyo', 'Asia/Kolkata', FROM, 400);
    expect(d.varies).toBe(false);
    expect(d.distinctGaps).toEqual([-210]); // 3h30 behind, all year
    expect(d.spans).toHaveLength(1);
    expect(d.shortestSpan).toBeNull();
  });

  it('handles two Australian cities where only one observes daylight saving', () => {
    const d = describeDifference('Australia/Brisbane', 'Australia/Sydney', FROM, 400);
    expect(d.distinctGaps).toEqual([0, 60]);
  });
});

describe('daylight saving profile', () => {
  it('identifies standard and daylight offsets for a northern zone', () => {
    const p = dstProfile('Europe/London', new Date(`${FROM}T00:00:00Z`));
    expect(p.observesDst).toBe(true);
    expect(p.standardOffset).toBe(0);
    expect(p.dstOffset).toBe(60);
    expect(p.nextTransition?.offsetAfter).toBe(0); // next change is falling back
  });

  it('identifies them for a southern zone, where the seasons are inverted', () => {
    const p = dstProfile('Australia/Sydney', new Date(`${FROM}T00:00:00Z`));
    expect(p.observesDst).toBe(true);
    expect(p.standardOffset).toBe(600);
    expect(p.dstOffset).toBe(660);
    expect(p.nextTransition?.offsetAfter).toBe(660); // next change is springing forward
  });

  it('reports a half-hour daylight saving zone correctly', () => {
    const p = dstProfile('Australia/Adelaide', new Date(`${FROM}T00:00:00Z`));
    expect(p.standardOffset).toBe(570); // +9:30
    expect(p.dstOffset).toBe(630); // +10:30
  });
});

describe('converting a time between two cities', () => {
  it('carries the day when the conversion crosses midnight', () => {
    // 09:00 in London on a December day is 20:00 in Sydney the same evening.
    expect(convertTime('2026-12-25', 'Europe/London', 9 * 60, 'Australia/Sydney')).toEqual({
      minutes: 20 * 60,
      dayShift: 0,
    });
    // 18:00 in London is 05:00 the next morning in Sydney.
    expect(convertTime('2026-12-25', 'Europe/London', 18 * 60, 'Australia/Sydney')).toEqual({
      minutes: 5 * 60,
      dayShift: 1,
    });
    // Going the other way lands on the previous day.
    expect(convertTime('2026-12-25', 'Australia/Sydney', 5 * 60, 'Europe/London')).toEqual({
      minutes: 18 * 60,
      dayShift: -1,
    });
  });

  it('gives a different answer for the same clock time on a different date', () => {
    const august = convertTime('2026-08-15', 'Europe/London', 9 * 60, 'Australia/Sydney');
    const december = convertTime('2026-12-25', 'Europe/London', 9 * 60, 'Australia/Sydney');
    expect(august.minutes).toBe(18 * 60); // 9h gap
    expect(december.minutes).toBe(20 * 60); // 11h gap
  });

  it('handles half-hour zones', () => {
    expect(convertTime('2026-08-15', 'Europe/London', 12 * 60, 'Asia/Kolkata')).toEqual({
      minutes: 16 * 60 + 30,
      dayShift: 0,
    });
  });
});

describe('span scanning', () => {
  it('covers exactly the requested number of days with no gaps or overlaps', () => {
    const spans = offsetSpans('Europe/London', 'Australia/Sydney', FROM, 400);
    expect(spans.reduce((sum, s) => sum + s.days, 0)).toBe(400);
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i].gapMinutes).not.toBe(spans[i - 1].gapMinutes);
    }
  });
});

describe('formatting', () => {
  it('reads as prose', () => {
    expect(formatGap(540)).toBe('9 hours ahead');
    expect(formatGap(-270)).toBe('4 hours 30 minutes behind');
    expect(formatGap(0)).toBe('the same time');
    expect(formatGap(60)).toBe('1 hour ahead');
    expect(formatGap(-45)).toBe('45 minutes behind');
  });

  it('has a compact form for tables', () => {
    expect(formatGapShort(540)).toBe('+9h');
    expect(formatGapShort(-270)).toBe('\u22124h30');
    expect(formatGapShort(0)).toBe('0');
  });
});
