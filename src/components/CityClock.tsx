import { useEffect, useState } from 'react';
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
 * The live part of a city page.
 *
 * Everything else on these pages is generated at build time, because daylight
 * saving dates and offsets do not change between builds. The current time
 * obviously does, so it is the one piece that has to run in the browser. Keeping
 * the split at exactly this line means the page is useful before any JavaScript
 * loads and precise once it does.
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

  // Rendered null on the server and on the first client paint, so the markup
  // never claims a time that is already wrong by the time it is read.
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (now === null) {
    return (
      <div className="rounded-2xl border border-paper-200 bg-white p-5">
        <p className="text-sm text-paper-500">Reading your clock&hellip;</p>
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

  return (
    <div className="rounded-2xl border border-paper-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-paper-500 uppercase">
            Current time in {name}
          </p>
          <p className="nums mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
            {formatMinutes(minutes)}
          </p>
          <p className="mt-1 text-sm text-paper-700">
            {new Intl.DateTimeFormat('en', {
              timeZone,
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }).format(now)}
          </p>
          <p className="nums mt-0.5 text-xs text-paper-500">
            UTC{formatOffset(offset)}
            {!sameZone && <> &middot; {formatGap(relative)} than you</>}
            {sameZone && <> &middot; your own time zone</>}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <SkyBadge state={sky.state} />
          <div className="nums text-xs text-paper-500">
            {sun.polar === true && <p className="font-medium text-paper-700">Sun does not set</p>}
            {sun.polar === false && <p className="font-medium text-paper-700">Sun does not rise</p>}
            {sun.sunrise !== null && <p>Sunrise {formatMinutes(sun.sunrise)}</p>}
            {sun.sunset !== null && <p>Sunset {formatMinutes(sun.sunset)}</p>}
            <p className="opacity-70">
              {Math.floor(sun.daylightMinutes / 60)}h {sun.daylightMinutes % 60}m of daylight
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkyBadge({ state }: { state: SkyState }) {
  const label = state === 'day' ? 'Daylight' : state === 'twilight' ? 'Twilight' : 'Dark';
  return (
    <span
      role="img"
      aria-label={`Currently ${label.toLowerCase()}`}
      title={label}
      className={`h-9 w-9 shrink-0 rounded-full border ${
        state === 'day'
          ? 'border-sky-day bg-sky-day'
          : state === 'twilight'
            ? 'border-sky-dusk bg-sky-dusk'
            : 'border-paper-300 bg-sky-night'
      }`}
    />
  );
}
