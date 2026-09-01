import { useEffect, useState } from 'react';
import { skyState } from '../lib/time/solar';
import {
  addDays,
  formatIsoDateLong,
  formatMinutes,
  formatOffset,
  isValidIsoDate,
  localMinutesOfDay,
  offsetMinutes,
  toIsoDate,
  zonedDateTimeToInstant,
} from '../lib/time/zone';
import { convertTime, formatGap, gapOnDate } from '../lib/time/difference';

interface Side {
  name: string;
  timeZone: string;
  latitude: number;
  slug: string;
}

/**
 * The live, interactive half of a pair page.
 *
 * The static half of the page already lists every gap and the dates it applies,
 * which is the part search engines can read. This is for the reader who has
 * arrived and now wants to answer their actual question: what is 3pm here over
 * there, on the day they care about. Changing the date is the whole point, so it
 * is a first-class control rather than buried.
 */
export default function PairClock({ a, b }: { a: Side; b: Side }) {
  const [now, setNow] = useState<Date | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);

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

  const today = toIsoDate(now, a.timeZone);
  const viewDate = date ?? today;
  const live = date === null && minutes === null;
  const minutesA = minutes ?? localMinutesOfDay(now, a.timeZone);

  const converted = convertTime(viewDate, a.timeZone, minutesA, b.timeZone);
  const gap = gapOnDate(a.timeZone, b.timeZone, viewDate);
  const gapToday = gapOnDate(a.timeZone, b.timeZone, today);

  // Resolved through the zone rather than by subtracting today's offset: on a
  // date the other side of a transition, today's offset is the wrong one.
  const instantA = zonedDateTimeToInstant(viewDate, a.timeZone, minutesA);
  const skyA = skyState(instantA, a.timeZone, a.latitude);
  const skyB = skyState(instantA, b.timeZone, b.latitude);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel
          name={a.name}
          slug={a.slug}
          minutes={minutesA}
          dayLabel={formatIsoDateLong(viewDate)}
          offset={offsetMinutes(instantA, a.timeZone)}
          sky={skyA.state}
        />
        <Panel
          name={b.name}
          slug={b.slug}
          minutes={converted.minutes}
          dayLabel={formatIsoDateLong(
            converted.dayShift === 0 ? viewDate : addDays(viewDate, converted.dayShift),
          )}
          offset={offsetMinutes(instantA, b.timeZone)}
          sky={skyB.state}
          note={
            converted.dayShift === 0
              ? undefined
              : converted.dayShift > 0
                ? 'next day'
                : 'previous day'
          }
        />
      </div>

      <div className="rounded-2xl border border-paper-200 bg-white p-4 sm:p-5">
        <p className="text-sm">
          <span className="font-medium">{b.name}</span> is {formatGap(gap)} than{' '}
          <span className="font-medium">{a.name}</span> on {formatIsoDateLong(viewDate)}.
          {gap !== gapToday && (
            <span className="text-warn-700">
              {' '}
              Today it is {formatGap(gapToday)} &mdash; daylight saving moves the gap between these
              two dates.
            </span>
          )}
        </p>

        <label className="mt-4 block">
          <span className="text-xs font-medium text-paper-500">Time in {a.name}</span>
          <input
            type="range"
            min={0}
            max={1425}
            step={15}
            value={minutesA}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="ring-focus mt-1 w-full accent-go-500"
            aria-label={`Time in ${a.name}`}
          />
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDate(addDays(viewDate, -1))}
            aria-label="Previous day"
            className="ring-focus rounded-md border border-paper-200 px-2 py-1 text-xs text-paper-500 hover:text-paper-900"
          >
            &larr;
          </button>
          <label>
            <span className="sr-only">Date in {a.name}</span>
            <input
              type="date"
              value={viewDate}
              onChange={(e) => {
                if (isValidIsoDate(e.target.value)) setDate(e.target.value);
              }}
              className="ring-focus nums rounded-md border border-paper-200 bg-white px-2 py-1 text-xs"
            />
          </label>
          <button
            type="button"
            onClick={() => setDate(addDays(viewDate, 1))}
            aria-label="Next day"
            className="ring-focus rounded-md border border-paper-200 px-2 py-1 text-xs text-paper-500 hover:text-paper-900"
          >
            &rarr;
          </button>
          {!live && (
            <button
              type="button"
              onClick={() => {
                setDate(null);
                setMinutes(null);
              }}
              className="ring-focus rounded-md bg-paper-900 px-2 py-1 text-xs font-medium text-paper-50"
            >
              Back to now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({
  name,
  slug,
  minutes,
  dayLabel,
  offset,
  sky,
  note,
}: {
  name: string;
  slug: string;
  minutes: number;
  dayLabel: string;
  offset: number;
  sky: 'day' | 'twilight' | 'night';
  note?: string;
}) {
  return (
    <div className="rounded-2xl border border-paper-200 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <a href={`/time/${slug}`} className="ring-focus text-sm font-medium hover:underline">
          {name}
        </a>
        <span
          role="img"
          aria-label={sky === 'day' ? 'Daylight' : sky === 'twilight' ? 'Twilight' : 'Dark'}
          className={`h-5 w-5 shrink-0 rounded-full border ${
            sky === 'day'
              ? 'border-sky-day bg-sky-day'
              : sky === 'twilight'
                ? 'border-sky-dusk bg-sky-dusk'
                : 'border-paper-300 bg-sky-night'
          }`}
        />
      </div>
      <p className="nums mt-1 text-3xl font-semibold tracking-tight tabular-nums">
        {formatMinutes(minutes)}
      </p>
      <p className="mt-0.5 text-xs text-paper-500">
        {dayLabel}
        {note && <span className="ml-1 font-medium text-paper-700">({note})</span>}
      </p>
      <p className="nums mt-0.5 text-[11px] text-paper-500">UTC{formatOffset(offset)}</p>
    </div>
  );
}
