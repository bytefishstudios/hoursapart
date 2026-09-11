import { useEffect, useState, type CSSProperties } from 'react';
import { skyState, sunTimes, type SkyState } from '../lib/time/solar';
import {
  formatMinutes,
  formatOffset,
  localMinutesOfDay,
  localTimeZone,
  offsetMinutes,
  toIsoDate,
} from '../lib/time/zone';
import { formatGap } from '../lib/time/difference';

/**
 * The live part of a city page. Static DST and daylight tables remain useful
 * without JavaScript; this card becomes exact once the browser clock is known.
 */
export default function CityClock({
  name,
  timeZone,
  latitude,
}: {
  name: string;
  timeZone: string;
  latitude: number;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (now === null) {
    return (
      <div className="min-h-60 animate-pulse rounded-[1.75rem] border border-paper-200 bg-white elev">
        <p className="p-6 text-sm text-paper-500">Reading your clock&hellip;</p>
      </div>
    );
  }

  const isoDate = toIsoDate(now, timeZone);
  const minutes = localMinutesOfDay(now, timeZone);
  const sky = skyState(now, timeZone, latitude);
  const sun = sunTimes(isoDate, latitude);
  const offset = offsetMinutes(now, timeZone);
  const viewerZone = localTimeZone();
  const relative = offset - offsetMinutes(now, viewerZone);
  const sameZone = viewerZone === timeZone;
  const strip = daylightGradient(sun.sunrise, sun.sunset, sun.polar);

  return (
    <section
      className={`city-live-card city-live-${sky.state} relative overflow-hidden rounded-[1.75rem] border border-paper-200 bg-white p-5 elev-lift sm:p-7`}
      aria-label={`Live time and daylight in ${name}`}
    >
      <div className="relative z-10 grid items-end gap-7 sm:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-paper-500 uppercase">
              Current time in {name}
            </p>
            <SkyBadge state={sky.state} />
          </div>
          <p className="nums mt-3 text-6xl leading-none font-semibold tracking-[-0.05em] tabular-nums sm:text-7xl">
            {formatMinutes(minutes)}
          </p>
          <p className="mt-3 text-base font-medium text-paper-700">
            {new Intl.DateTimeFormat('en', {
              timeZone,
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }).format(now)}
          </p>
          <p className="nums mt-1 text-xs text-paper-500">
            UTC{formatOffset(offset)}
            {!sameZone && <> &middot; {formatGap(relative)} you</>}
            {sameZone && <> &middot; your own time zone</>}
          </p>
        </div>

        <dl className="grid grid-cols-3 overflow-hidden rounded-2xl border border-paper-200 bg-paper-50/75">
          <SunStat
            label="Sunrise"
            value={
              sun.sunrise === null
                ? sun.polar
                  ? 'No sunset'
                  : 'No sunrise'
                : formatMinutes(sun.sunrise)
            }
          />
          <SunStat
            label="Sunset"
            value={
              sun.sunset === null
                ? sun.polar
                  ? 'No sunset'
                  : 'No sunrise'
                : formatMinutes(sun.sunset)
            }
          />
          <SunStat
            label="Daylight"
            value={`${Math.floor(sun.daylightMinutes / 60)}h ${sun.daylightMinutes % 60}m`}
          />
        </dl>
      </div>

      <div className="relative z-10 mt-7">
        <div
          className="sky-strip relative h-4 overflow-hidden rounded-full border border-paper-900/10"
          style={{ '--sky-stops': strip } as CSSProperties}
          role="img"
          aria-label={`${name}'s daylight across today; marker at ${formatMinutes(minutes)}`}
        >
          <span
            className="sky-marker absolute top-0 h-full w-0.5 bg-paper-900"
            style={{ left: `calc(${(minutes / 1440) * 100}% - 1px)` }}
            aria-hidden="true"
          />
        </div>
        <div
          className="nums mt-1.5 flex justify-between text-[10px] text-paper-500"
          aria-hidden="true"
        >
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>00:00</span>
        </div>
      </div>
    </section>
  );
}

function SkyBadge({ state }: { state: SkyState }) {
  const label =
    state === 'day' ? 'Daylight now' : state === 'twilight' ? 'Twilight now' : 'Dark now';
  const dot =
    state === 'day' ? 'bg-sky-day' : state === 'twilight' ? 'bg-sky-dusk' : 'bg-sky-night';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-paper-200 bg-white/80 px-2 py-1 text-[10px] font-semibold text-paper-700">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function SunStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-paper-200 px-2 py-3 text-center last:border-r-0 sm:px-3 sm:py-4">
      <dt className="text-[9px] font-semibold tracking-wide text-paper-500 uppercase">{label}</dt>
      <dd className="nums mt-1 text-xs font-semibold sm:text-sm">{value}</dd>
    </div>
  );
}

function daylightGradient(
  sunrise: number | null,
  sunset: number | null,
  polar: boolean | null,
): string {
  if (sunrise === null || sunset === null) {
    return polar
      ? 'var(--color-sky-day) 0%, var(--color-sky-day) 100%'
      : 'var(--color-sky-night) 0%, var(--color-sky-night) 100%';
  }

  const at = (value: number) =>
    `${((Math.max(0, Math.min(1440, value)) / 1440) * 100).toFixed(2)}%`;
  return [
    `var(--color-sky-night) 0%`,
    `var(--color-sky-night) ${at(sunrise - 45)}`,
    `var(--color-sky-dusk) ${at(sunrise)}`,
    `var(--color-sky-day) ${at(sunrise + 35)}`,
    `var(--color-sky-day) ${at(sunset - 35)}`,
    `var(--color-sky-dusk) ${at(sunset)}`,
    `var(--color-sky-night) ${at(sunset + 45)}`,
    `var(--color-sky-night) 100%`,
  ].join(', ');
}
