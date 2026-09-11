import { useEffect, useState } from 'react';
import { skyState } from '../lib/time/solar';
import {
  formatIsoDateLong,
  formatMinutes,
  formatOffset,
  localMinutesOfDay,
  offsetMinutes,
  toIsoDate,
  zonedDateTimeToInstant,
} from '../lib/time/zone';
import { convertTime, formatGap, gapOnDate } from '../lib/time/difference';
import DateControl from './DateControl';

interface Side {
  name: string;
  timeZone: string;
  latitude: number;
  slug: string;
}

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
      <div className="min-h-72 animate-pulse rounded-[1.75rem] border border-paper-200 bg-white elev">
        <p className="p-6 text-sm text-paper-500">Reading your clock&hellip;</p>
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
  const instantA = zonedDateTimeToInstant(viewDate, a.timeZone, minutesA);
  const skyA = skyState(instantA, a.timeZone, a.latitude);
  const skyB = skyState(instantA, b.timeZone, b.latitude);
  const relativeDescription =
    gap === 0 ? `the same time as ${a.name}` : `${formatGap(gap)} of ${a.name}`;

  return (
    <section
      className="overflow-hidden rounded-[1.75rem] border border-paper-200 bg-white elev-lift"
      aria-label={`Time converter between ${a.name} and ${b.name}`}
    >
      <div className="grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <Panel
          sideLabel="Starting in"
          name={a.name}
          slug={a.slug}
          minutes={minutesA}
          dayLabel={formatIsoDateLong(viewDate)}
          offset={offsetMinutes(instantA, a.timeZone)}
          sky={skyA.state}
        />

        <div className="flex items-center justify-center border-y border-paper-200 bg-paper-100/60 px-3 py-2 sm:border-x sm:border-y-0">
          <div className="text-center">
            <span className="hidden text-lg text-paper-500 sm:block" aria-hidden="true">
              &rarr;
            </span>
            <span className="nums whitespace-nowrap rounded-full border border-paper-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-paper-700">
              {gap === 0 ? 'same time' : formatGap(gap)}
            </span>
          </div>
        </div>

        <Panel
          sideLabel="Same moment in"
          name={b.name}
          slug={b.slug}
          minutes={converted.minutes}
          dayLabel={formatIsoDateLong(
            converted.dayShift === 0 ? viewDate : toIsoDate(instantA, b.timeZone),
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

      <div className="border-t border-paper-200 bg-paper-50/55 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-2xl text-sm leading-relaxed">
            <strong className="font-semibold">{b.name}</strong> is {relativeDescription} on{' '}
            {formatIsoDateLong(viewDate)}.
            {gap !== gapToday && (
              <span className="text-warn-700">
                {' '}
                Today it is {gapToday === 0 ? 'the same time' : formatGap(gapToday)}; daylight
                saving changes the answer between these dates.
              </span>
            )}
          </p>
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-paper-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-paper-500">
              <span className="h-1.5 w-1.5 rounded-full bg-go-500" aria-hidden="true" /> Live
            </span>
          )}
        </div>

        <label className="mt-5 block">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-paper-500 uppercase">
            Time in {a.name}
          </span>
          <input
            type="range"
            min={0}
            max={1425}
            step={15}
            value={minutesA}
            onChange={(event) => setMinutes(Number(event.target.value))}
            className="slider mt-1"
            aria-label={`Time in ${a.name}`}
            aria-valuetext={`${formatMinutes(minutesA)} in ${a.name}`}
          />
        </label>
        <div className="nums flex justify-between text-[10px] text-paper-500" aria-hidden="true">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>00:00</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DateControl
            date={live ? null : viewDate}
            today={today}
            onChange={(next) => {
              if (next === null) {
                setDate(null);
                setMinutes(null);
              } else {
                setDate(next);
              }
            }}
            label={`Date in ${a.name}`}
          />
          {!live && (
            <button
              type="button"
              onClick={() => {
                setDate(null);
                setMinutes(null);
              }}
              className="ring-focus h-9 rounded-lg border border-paper-200 bg-white px-3 text-xs font-semibold text-paper-700 hover:border-paper-300"
            >
              Back to now
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Panel({
  sideLabel,
  name,
  slug,
  minutes,
  dayLabel,
  offset,
  sky,
  note,
}: {
  sideLabel: string;
  name: string;
  slug: string;
  minutes: number;
  dayLabel: string;
  offset: number;
  sky: 'day' | 'twilight' | 'night';
  note?: string;
}) {
  const skyClass =
    sky === 'day' ? 'bg-sky-day' : sky === 'twilight' ? 'bg-sky-dusk' : 'bg-sky-night';
  return (
    <div className={`pair-panel pair-panel-${sky} relative overflow-hidden p-5 sm:p-7`}>
      <div className="relative z-10">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold tracking-[0.15em] text-paper-500 uppercase">
            {sideLabel}
          </p>
          <span
            role="img"
            aria-label={sky === 'day' ? 'Daylight' : sky === 'twilight' ? 'Twilight' : 'Dark'}
            className={`h-3 w-3 rounded-full border border-paper-900/10 ${skyClass}`}
          />
        </div>
        <a
          href={`/time/${slug}`}
          className="ring-focus mt-3 inline-block rounded text-sm font-semibold hover:underline"
        >
          {name}
        </a>
        <p className="nums mt-1 text-5xl font-semibold tracking-[-0.045em] tabular-nums">
          {formatMinutes(minutes)}
        </p>
        <p className="mt-1 text-xs text-paper-500">
          {dayLabel}
          {note && <span className="ml-1 font-semibold text-warn-700">({note})</span>}
        </p>
        <p className="nums mt-1 text-[11px] text-paper-500">UTC{formatOffset(offset)}</p>
      </div>
    </div>
  );
}
