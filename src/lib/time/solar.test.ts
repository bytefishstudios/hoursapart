import { describe, expect, it } from 'vitest';
import { daylightHours, skyState, solarElevation, sunTimes } from './solar';
import { resolveLocalTime } from './dst';
import { CITIES, latitudeFor } from './cities';

/**
 * Checked against facts anyone can verify without a table:
 *
 *  - Singapore sits on the equator, so its day is ~12 hours all year.
 *  - Reykjavik at 64°N never gets properly dark at midsummer, and the sun
 *    barely clears the horizon at midwinter noon.
 *  - Sydney and London are in opposite seasons, so 19:00 is light in one and
 *    dark in the other on the same date.
 */

const LAT = {
  singapore: 1.35,
  reykjavik: 64.15,
  sydney: -33.87,
  london: 51.51,
} as const;

/** An instant that reads as the given local time in the given zone. */
function localAt(date: string, timeZone: string, hour: number, minute = 0): Date {
  return resolveLocalTime(new Date(`${date}T12:00:00Z`), timeZone, hour * 60 + minute);
}

describe('equatorial cities', () => {
  it('are light at noon and dark at midnight, in both solstices', () => {
    for (const date of ['2026-06-21', '2026-12-21']) {
      const noon = localAt(date, 'Asia/Singapore', 12);
      const midnight = localAt(date, 'Asia/Singapore', 0);

      expect(skyState(noon, 'Asia/Singapore', LAT.singapore).state, `noon ${date}`).toBe('day');
      expect(skyState(midnight, 'Asia/Singapore', LAT.singapore).state, `midnight ${date}`).toBe(
        'night',
      );
    }
  });

  it('have a nearly identical sun angle at noon in June and December', () => {
    const june = solarElevation(
      localAt('2026-06-21', 'Asia/Singapore', 12),
      'Asia/Singapore',
      LAT.singapore,
    );
    const december = solarElevation(
      localAt('2026-12-21', 'Asia/Singapore', 12),
      'Asia/Singapore',
      LAT.singapore,
    );
    // Both near vertical, and within the 23.4 degrees of axial tilt of each other.
    expect(june).toBeGreaterThan(60);
    expect(december).toBeGreaterThan(60);
    expect(Math.abs(june - december)).toBeLessThan(25);
  });
});

describe('the Arctic edge', () => {
  it('never gets properly dark in Reykjavik at midsummer', () => {
    const midnight = localAt('2026-06-21', 'Atlantic/Reykjavik', 0);
    const { state, elevation } = skyState(midnight, 'Atlantic/Reykjavik', LAT.reykjavik);

    // Sun dips just below the horizon but stays inside civil twilight.
    expect(state).not.toBe('night');
    expect(elevation).toBeLessThan(0);
    expect(elevation).toBeGreaterThan(-6);
  });

  it('barely lifts the sun above the horizon at midwinter noon in Reykjavik', () => {
    const noon = localAt('2026-12-21', 'Atlantic/Reykjavik', 12);
    const { state, elevation } = skyState(noon, 'Atlantic/Reykjavik', LAT.reykjavik);

    expect(state).toBe('day');
    expect(elevation).toBeGreaterThan(0);
    expect(elevation).toBeLessThan(6);
  });

  it('is dark in Reykjavik at 09:00 in midwinter, when London is not', () => {
    const date = '2026-12-21';
    const rkNine = skyState(
      localAt(date, 'Atlantic/Reykjavik', 9),
      'Atlantic/Reykjavik',
      LAT.reykjavik,
    );
    const lonNine = skyState(localAt(date, 'Europe/London', 9), 'Europe/London', LAT.london);

    expect(rkNine.state).not.toBe('day');
    expect(lonNine.state).toBe('day');
  });
});

describe('opposite hemispheres', () => {
  it('puts 19:00 in daylight in Sydney and darkness in London in December', () => {
    const date = '2026-12-21';
    expect(
      skyState(localAt(date, 'Australia/Sydney', 19), 'Australia/Sydney', LAT.sydney).state,
    ).toBe('day');
    expect(skyState(localAt(date, 'Europe/London', 19), 'Europe/London', LAT.london).state).toBe(
      'night',
    );
  });

  it('reverses that in June', () => {
    const date = '2026-06-21';
    expect(
      skyState(localAt(date, 'Australia/Sydney', 19), 'Australia/Sydney', LAT.sydney).state,
    ).toBe('night');
    expect(skyState(localAt(date, 'Europe/London', 19), 'Europe/London', LAT.london).state).toBe(
      'day',
    );
  });

  it('agrees that Sydney sunset moves by hours between seasons', () => {
    const winter = solarElevation(
      localAt('2026-06-21', 'Australia/Sydney', 17),
      'Australia/Sydney',
      LAT.sydney,
    );
    const summer = solarElevation(
      localAt('2026-12-21', 'Australia/Sydney', 17),
      'Australia/Sydney',
      LAT.sydney,
    );
    expect(winter).toBeLessThan(0); // already set
    expect(summer).toBeGreaterThan(15); // still well up
  });
});

describe('graceful degradation', () => {
  it('falls back to a clock rule and flags it when latitude is unknown', () => {
    const noon = localAt('2026-06-21', 'Asia/Muscat', 12);
    const result = skyState(noon, 'Asia/Muscat', undefined);

    expect(result.approximate).toBe(true);
    expect(result.elevation).toBeNull();
    expect(result.state).toBe('day');
  });

  it('does not flag as approximate when latitude is known', () => {
    const noon = localAt('2026-06-21', 'Asia/Singapore', 12);
    expect(skyState(noon, 'Asia/Singapore', LAT.singapore).approximate).toBe(false);
  });
});

describe('city latitude data', () => {
  it('covers every city with a plausible value', () => {
    for (const city of CITIES) {
      expect(Number.isFinite(city.lat), city.name).toBe(true);
      expect(Math.abs(city.lat), city.name).toBeLessThanOrEqual(90);
    }
  });

  it('distinguishes cities that share a zone but not a latitude', () => {
    // Miami and Boston are both America/New_York, 16 degrees apart. A per-zone
    // latitude table would collapse them and get winter daylight badly wrong.
    const miami = CITIES.find((c) => c.name === 'Miami')!;
    const boston = CITIES.find((c) => c.name === 'Boston')!;
    expect(miami.timeZone).toBe(boston.timeZone);
    expect(Math.abs(boston.lat - miami.lat)).toBeGreaterThan(10);

    const date = '2026-12-21';
    const miamiSun = solarElevation(
      localAt(date, miami.timeZone, 16, 45),
      miami.timeZone,
      miami.lat,
    );
    const bostonSun = solarElevation(
      localAt(date, boston.timeZone, 16, 45),
      boston.timeZone,
      boston.lat,
    );
    // Late afternoon in midwinter: still up in Florida, gone in Massachusetts.
    expect(miamiSun).toBeGreaterThan(0);
    expect(bostonSun).toBeLessThan(0);
  });

  it('resolves latitude by zone and by label', () => {
    expect(latitudeFor('Australia/Sydney')).toBeCloseTo(-33.87, 1);
    expect(latitudeFor('America/New_York', 'Boston')).toBeCloseTo(42.36, 1);
    expect(latitudeFor('Not/AZone')).toBeUndefined();
  });
});

/**
 * Daylight *duration* is driven by latitude and season, so it is accurate.
 * Sunrise and sunset *clock times* inherit the central-meridian assumption
 * documented in solar.ts and can be up to about 75 minutes out for a city far
 * from its zone's meridian. The assertions below are tight on duration and
 * loose on absolute times, which is an honest reflection of the model.
 */
describe('sunrise and sunset', () => {
  it('gives close to twelve hours everywhere at the equinox', () => {
    for (const lat of [-33.87, 0, 51.51, -1.29, 35.68]) {
      const { daylightMinutes } = sunTimes('2027-03-20', lat);
      expect(Math.abs(daylightMinutes - 720), `lat ${lat}`).toBeLessThan(20);
    }
  });

  it('keeps the tropics near twelve hours all year', () => {
    const june = sunTimes('2026-06-21', 1.35).daylightMinutes;
    const december = sunTimes('2026-12-21', 1.35).daylightMinutes;
    expect(Math.abs(june - december)).toBeLessThan(20);
    expect(june).toBeGreaterThan(700);
    expect(june).toBeLessThan(740);
  });

  it('inverts the seasons across the equator', () => {
    const sydney = -33.87;
    const june = sunTimes('2026-06-21', sydney).daylightMinutes;
    const december = sunTimes('2026-12-21', sydney).daylightMinutes;
    // Sydney gets about 9h54m in midwinter and about 14h25m in midsummer.
    expect(june).toBeGreaterThan(570);
    expect(june).toBeLessThan(620);
    expect(december).toBeGreaterThan(840);
    expect(december).toBeLessThan(890);
    expect(december).toBeGreaterThan(june);

    // London, at a similar latitude north, must be the other way round.
    const london = 51.51;
    expect(sunTimes('2026-06-21', london).daylightMinutes).toBeGreaterThan(
      sunTimes('2026-12-21', london).daylightMinutes,
    );
  });

  it('gives higher latitudes a longer midsummer day', () => {
    const byLatitude = [1.35, 35.68, 51.51, 61.22, 64.15].map(
      (lat) => sunTimes('2026-06-21', lat).daylightMinutes,
    );
    for (let i = 1; i < byLatitude.length; i += 1) {
      expect(byLatitude[i]).toBeGreaterThan(byLatitude[i - 1]);
    }
    // Reykjavik gets close to 21 hours but the sun does still set.
    expect(byLatitude[4]).toBeGreaterThan(1200);
    expect(byLatitude[4]).toBeLessThan(1400);
    expect(sunTimes('2026-06-21', 64.15).sunset).not.toBeNull();
  });

  it('reports polar day and polar night rather than inventing a sunrise', () => {
    // Svalbard, well inside the Arctic circle.
    const midsummer = sunTimes('2026-06-21', 78.2);
    expect(midsummer.sunrise).toBeNull();
    expect(midsummer.sunset).toBeNull();
    expect(midsummer.polar).toBe(true);
    expect(midsummer.daylightMinutes).toBe(1440);

    const midwinter = sunTimes('2026-12-21', 78.2);
    expect(midwinter.sunrise).toBeNull();
    expect(midwinter.sunset).toBeNull();
    expect(midwinter.polar).toBe(false);
    expect(midwinter.daylightMinutes).toBe(0);
  });

  it('puts sunrise before sunset and daylight between them on an ordinary day', () => {
    const { sunrise, sunset, daylightMinutes, polar } = sunTimes('2026-09-15', 51.51);
    expect(polar).toBeNull();
    expect(sunrise).not.toBeNull();
    expect(sunset).not.toBeNull();
    expect(sunrise!).toBeLessThan(sunset!);
    expect(sunset! - sunrise!).toBe(daylightMinutes);
  });

  it('agrees with the hours helper', () => {
    expect(daylightHours('2026-06-21', -33.87)).toBeCloseTo(
      Math.round((sunTimes('2026-06-21', -33.87).daylightMinutes / 60) * 10) / 10,
      5,
    );
  });
});
