import { describe, expect, it } from 'vitest';
import { decodeScenario, encodeScenario, type Scenario } from './share';
import { DEFAULT_WORK_DAYS, type Participant } from './overlap';
import {
  CITIES,
  HUBS,
  cityByName,
  cityBySlug,
  citiesSharingZone,
  labelForTimeZone,
  searchCities,
} from './cities';

const person = (over: Partial<Participant> & { id: string; timeZone: string }): Participant => ({
  label: over.label ?? labelForTimeZone(over.timeZone),
  workStart: 9 * 60,
  workEnd: 17 * 60,
  workDays: DEFAULT_WORK_DAYS,
  ...over,
});

describe('scenario links', () => {
  const scenario: Scenario = {
    participants: [
      person({ id: 'p0', timeZone: 'Australia/Sydney' }),
      person({
        id: 'p1',
        timeZone: 'Europe/London',
        workStart: 8 * 60 + 30,
        workEnd: 16 * 60 + 30,
      }),
      person({ id: 'p2', timeZone: 'Asia/Kolkata', workDays: [0, 1, 2, 3, 4] }),
    ],
    anchorIndex: 1,
    meetingMinutes: 9 * 60,
    date: '2026-12-25',
  };

  it('round-trips a full scenario', () => {
    const decoded = decodeScenario(`?${encodeScenario(scenario)}`)!;

    expect(decoded.participants).toHaveLength(3);
    expect(decoded.anchorIndex).toBe(1);
    expect(decoded.meetingMinutes).toBe(540);
    expect(decoded.date).toBe('2026-12-25');
    expect(decoded.participants[0].timeZone).toBe('Australia/Sydney');
    expect(decoded.participants[1].workStart).toBe(8 * 60 + 30);
    expect(decoded.participants[1].workEnd).toBe(16 * 60 + 30);
    expect(decoded.participants[2].workDays).toEqual([0, 1, 2, 3, 4]);
  });

  it('preserves half-hour working hours, which hour-only encoding would lose', () => {
    const decoded = decodeScenario(`?${encodeScenario(scenario)}`)!;
    expect(decoded.participants[1].workStart % 60).toBe(30);
  });

  it('omits labels it can derive, and keeps ones it cannot', () => {
    const encoded = encodeScenario({
      participants: [
        person({ id: 'p0', timeZone: 'Australia/Sydney' }),
        person({ id: 'p1', timeZone: 'Europe/London', label: 'Priya' }),
      ],
      anchorIndex: 0,
      meetingMinutes: null,
      date: null,
    });

    // A derived label adds no field; a custom one adds a fifth. Checking the
    // field count rather than searching for "Sydney", which is in the zone id
    // regardless.
    const [sydneyChunk, londonChunk] = decodeURIComponent(encoded).replace(/^p=/, '').split('_');
    expect(sydneyChunk.split('-')).toHaveLength(4);
    expect(londonChunk.split('-')).toHaveLength(5);
    expect(encoded).toContain('Priya');

    const decoded = decodeScenario(`?${encoded}`)!;
    expect(decoded.participants[0].label).toBe('Sydney');
    expect(decoded.participants[1].label).toBe('Priya');
  });

  it('returns null when there is nothing usable', () => {
    expect(decodeScenario('')).toBeNull();
    expect(decodeScenario('?p=')).toBeNull();
    expect(decodeScenario('?a=2&m=540')).toBeNull();
  });

  it('drops invalid zones instead of failing the whole link', () => {
    const decoded = decodeScenario('?p=Not/AZone-540-1020-12345_Asia/Tokyo-540-1020-12345')!;
    expect(decoded.participants).toHaveLength(1);
    expect(decoded.participants[0].timeZone).toBe('Asia/Tokyo');
  });

  it('falls back to sane working hours on junk input', () => {
    const decoded = decodeScenario('?p=Asia/Tokyo-abc-99999-xyz')!;
    expect(decoded.participants[0].workStart).toBe(9 * 60);
    expect(decoded.participants[0].workEnd).toBe(17 * 60);
    expect(decoded.participants[0].workDays).toEqual(DEFAULT_WORK_DAYS);
  });

  it('clamps an out-of-range anchor and meeting time', () => {
    const decoded = decodeScenario('?p=Asia/Tokyo-540-1020-12345&a=9&m=5000')!;
    expect(decoded.anchorIndex).toBe(0);
    expect(decoded.meetingMinutes).toBeNull();
  });

  it('leaves the date out of the link when it means "today"', () => {
    const encoded = encodeScenario({ ...scenario, date: null });
    expect(encoded).not.toContain('d=');
    expect(decodeScenario(`?${encoded}`)!.date).toBeNull();
  });

  it('ignores a malformed or impossible date rather than rendering one', () => {
    for (const bad of ['not-a-date', '2026-13-01', '2026-02-30', '26-01-01', '2026-1-1']) {
      const decoded = decodeScenario(`?p=Asia/Tokyo-540-1020-12345&d=${bad}`)!;
      expect(decoded.date, bad).toBeNull();
    }
  });

  it('reads links made before dates existed', () => {
    const decoded = decodeScenario(
      '?p=Australia/Sydney-540-1020-12345_Europe/London-540-1020-12345&a=0&m=540',
    )!;
    expect(decoded.participants).toHaveLength(2);
    expect(decoded.date).toBeNull();
    expect(decoded.meetingMinutes).toBe(540);
  });
});

describe('city search', () => {
  it('matches on name prefix', () => {
    expect(searchCities('syd')[0].timeZone).toBe('Australia/Sydney');
    expect(searchCities('lond')[0].timeZone).toBe('Europe/London');
  });

  it('matches on airport code and abbreviation aliases', () => {
    expect(searchCities('LAX')[0].timeZone).toBe('America/Los_Angeles');
    expect(searchCities('blr')[0].name).toBe('Bengaluru');
  });

  it('matches former names', () => {
    expect(searchCities('bombay')[0].name).toBe('Mumbai');
    expect(searchCities('bangalore')[0].name).toBe('Bengaluru');
    expect(searchCities('saigon')[0].name).toBe('Ho Chi Minh City');
  });

  it('ignores accents so an ASCII keyboard still finds the city', () => {
    expect(searchCities('sao paulo')[0].timeZone).toBe('America/Sao_Paulo');
    expect(searchCities('bogota')[0].timeZone).toBe('America/Bogota');
  });

  it('finds cities by country', () => {
    const results = searchCities('japan');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((c) => c.country === 'Japan')).toBe(true);
  });

  it('returns nothing for an empty query', () => {
    expect(searchCities('')).toHaveLength(0);
    expect(searchCities('   ')).toHaveLength(0);
  });

  it('derives a label for zones missing from the city list', () => {
    expect(labelForTimeZone('Asia/Muscat')).toBe('Muscat');
    expect(labelForTimeZone('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(labelForTimeZone('Australia/Sydney')).toBe('Sydney');
  });
});

/**
 * Slugs are the SEO asset. Once a page is indexed, changing its slug throws
 * away whatever ranking it earned, so these are pinned deliberately.
 */
describe('city slugs', () => {
  it('produces clean URL segments from awkward names', () => {
    expect(cityByName('New York')!.slug).toBe('new-york');
    expect(cityByName('São Paulo')!.slug).toBe('sao-paulo');
    expect(cityByName('Bogotá')!.slug).toBe('bogota');
    expect(cityByName('Washington DC')!.slug).toBe('washington-dc');
    expect(cityByName('Ho Chi Minh City')!.slug).toBe('ho-chi-minh-city');
    expect(cityByName('UTC')!.slug).toBe('utc');
  });

  it('every city has a unique, resolvable, URL-safe slug', () => {
    const slugs = CITIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(CITIES.length);
    for (const city of CITIES) {
      expect(city.slug, city.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(cityBySlug(city.slug)?.name).toBe(city.name);
      expect(encodeURIComponent(city.slug)).toBe(city.slug);
    }
  });

  it('has enough hubs to be worth generating pairs, and they are real cities', () => {
    expect(HUBS.length).toBeGreaterThanOrEqual(20);
    expect(HUBS.every((h) => CITIES.includes(h))).toBe(true);
    // The hemisphere problem is the point, so both sides must be represented.
    expect(HUBS.some((h) => h.lat < -20)).toBe(true);
    expect(HUBS.some((h) => h.lat > 40)).toBe(true);
  });

  it('groups cities that share a zone without listing the city itself', () => {
    const sydney = cityByName('Sydney')!;
    const shared = citiesSharingZone(sydney);
    expect(shared.map((c) => c.name)).toContain('Canberra');
    expect(shared.map((c) => c.name)).not.toContain('Sydney');
  });
});
