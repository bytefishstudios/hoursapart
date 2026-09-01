import { zonedParts } from './zone';

/**
 * Day/night for the clock face.
 *
 * Knowing it is 15:00 in Helsinki tells you very little. Knowing it is already
 * dark there tells you whether to call. That is the actual question a world
 * clock is asked, and no mainstream one answers it.
 *
 * WHY ONLY LATITUDE IS NEEDED
 *
 * NOAA's solar position method needs longitude and the UTC offset to convert
 * clock time into true solar time:
 *
 *   timeOffset = eqTime + 4 * longitude - 60 * utcOffsetHours
 *
 * We take each city's longitude to be its time zone's central meridian, i.e.
 * `longitude = offsetMinutes / 4`. Substituting, `4 * longitude` and
 * `60 * utcOffsetHours` are the same quantity and cancel exactly, leaving
 *
 *   trueSolarTime = localClockTime + equationOfTime
 *
 * So latitude and the local clock are sufficient, and no longitude table has to
 * be maintained or kept correct.
 *
 * THE COST OF THAT ASSUMPTION
 *
 * Cities are not on their central meridian. Madrid sits near 3.7°W but keeps
 * CET, whose meridian is 15°E, so its real solar time runs about 75 minutes
 * behind what we assume. The error shifts the sunrise and sunset *boundary* by
 * that much; it does not affect day *length*, which is driven by latitude and
 * season. For an at-a-glance indicator that is a fair trade. For an
 * astronomical calculation it would not be.
 */

export type SkyState = 'day' | 'twilight' | 'night';

/** Sunrise and sunset are defined at this elevation, allowing for refraction. */
const HORIZON_DEGREES = -0.833;
/** Civil twilight: still enough light to read outdoors. */
const CIVIL_TWILIGHT_DEGREES = -6;

const RAD = Math.PI / 180;

/** Solar elevation in degrees above the horizon. Negative below. */
export function solarElevation(instant: Date, timeZone: string, latitude: number): number {
  const p = zonedParts(instant, timeZone);
  return solarElevationAt(p.year, p.month, p.day, p.hour * 60 + p.minute, latitude);
}

/**
 * Elevation from calendar components rather than an instant.
 *
 * Sampling a whole day through `solarElevation` would mean 1440 `Intl` lookups
 * to recover components we already know. Splitting the pure arithmetic out
 * makes sunrise and sunset cheap enough to compute for every city at build
 * time.
 */
export function solarElevationAt(
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
  latitude: number,
): number {
  const dayOfYear = dayOfYearFrom(year, month, day);
  const localMinutes = minutesOfDay;
  const hour = Math.floor(minutesOfDay / 60);

  // Fractional year, in radians (NOAA).
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24);

  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // Longitude and offset cancel — see the note above.
  const trueSolarTime = localMinutes + equationOfTime;
  const hourAngle = (trueSolarTime / 4 - 180) * RAD;

  const lat = latitude * RAD;
  const sinElevation =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);

  return Math.asin(Math.max(-1, Math.min(1, sinElevation))) / RAD;
}

/**
 * Day, civil twilight or night.
 *
 * With no latitude available, falls back to a plain clock-hour rule and says so
 * by way of the `approximate` flag, rather than pretending to know that the sun
 * is up.
 */
export function skyState(
  instant: Date,
  timeZone: string,
  latitude?: number,
): { state: SkyState; elevation: number | null; approximate: boolean } {
  if (latitude === undefined || !Number.isFinite(latitude)) {
    const { hour } = zonedParts(instant, timeZone);
    const state: SkyState =
      hour >= 7 && hour < 19 ? 'day' : hour >= 6 && hour < 20 ? 'twilight' : 'night';
    return { state, elevation: null, approximate: true };
  }

  const elevation = solarElevation(instant, timeZone, latitude);
  const state: SkyState =
    elevation > HORIZON_DEGREES ? 'day' : elevation > CIVIL_TWILIGHT_DEGREES ? 'twilight' : 'night';

  return { state, elevation, approximate: false };
}

export interface SunTimes {
  /** Local minutes since midnight, or `null` inside a polar day or night. */
  sunrise: number | null;
  sunset: number | null;
  /** Minutes of daylight, 0 to 1440. */
  daylightMinutes: number;
  /** `true` when the sun never sets, `false` when it never rises, else null. */
  polar: boolean | null;
}

/**
 * Sunrise and sunset on a calendar date, by sampling.
 *
 * Deliberately not the closed-form sunrise equation. That equation has no real
 * solution inside the polar circles, so it needs special-casing for exactly the
 * cities where the answer is most interesting — Reykjavik, Anchorage, Helsinki
 * in midsummer. Sampling handles them without a branch: no crossing found means
 * no sunrise, and the elevation sign says which kind of polar day it is.
 *
 * One-minute resolution, which is finer than the accuracy of the underlying
 * central-meridian assumption anyway.
 */
export function sunTimes(isoDate: string, latitude: number): SunTimes {
  const [year, month, day] = isoDate.split('-').map(Number);

  let sunrise: number | null = null;
  let sunset: number | null = null;
  let daylightMinutes = 0;
  let previousUp = solarElevationAt(year, month, day, 0, latitude) > HORIZON_DEGREES;
  const startedUp = previousUp;

  for (let m = 1; m <= 1440; m += 1) {
    const up = solarElevationAt(year, month, day, m % 1440, latitude) > HORIZON_DEGREES;
    if (up) daylightMinutes += 1;
    if (up && !previousUp && sunrise === null) sunrise = m;
    if (!up && previousUp && sunset === null) sunset = m;
    previousUp = up;
  }

  const polar = sunrise === null && sunset === null ? startedUp : null;

  return { sunrise, sunset, daylightMinutes, polar };
}

/** Hours of daylight on the local calendar day, to one decimal place. */
export function daylightHours(isoDate: string, latitude: number): number {
  return Math.round((sunTimes(isoDate, latitude).daylightMinutes / 60) * 10) / 10;
}

function dayOfYearFrom(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 0, 1);
  const current = Date.UTC(year, month - 1, day);
  return Math.round((current - start) / 86_400_000) + 1;
}
