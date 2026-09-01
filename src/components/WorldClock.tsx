import { useEffect, useMemo, useState } from 'react';
import { useScenario } from '../lib/time/useScenario';
import { latitudeFor } from '../lib/time/cities';
import { skyState, type SkyState } from '../lib/time/solar';
import {
  formatIsoDate,
  formatMinutes,
  formatOffset,
  localMinutesOfDay,
  localTimeZone,
  offsetMinutes,
  toIsoDate,
  zonedDateTimeToInstant,
  zonedParts,
} from '../lib/time/zone';
import CityPicker from './CityPicker';
import DateControl from './DateControl';

/** 30-minute resolution for the sky strip: smooth enough, cheap enough. */
const STRIP_STEPS = 48;

const SKY_CLASS: Record<SkyState, string> = {
  day: 'bg-sky-day',
  twilight: 'bg-sky-dusk',
  night: 'bg-sky-night',
};

export default function WorldClock() {
  const s = useScenario();
  const [now, setNow] = useState(() => new Date());
  const [hour12, setHour12] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const viewerZone = useMemo(
    () => (s.hydrated ? localTimeZone() : s.anchor?.timeZone),
    [s.hydrated, s.anchor],
  );

  const anchorZone = s.anchor?.timeZone ?? 'UTC';
  const today = toIsoDate(now, anchorZone);
  const viewDate = s.date ?? today;

  /**
   * The time of day being shown. Falls back to the live clock, so pinning a
   * date alone gives you "this time of day, on that date" and keeps ticking.
   */
  const viewMinutes = s.meetingMinutes ?? localMinutesOfDay(now, anchorZone);
  const isLive = s.date === null && s.meetingMinutes === null;

  /** The instant every row renders at. Stable once a time is explicitly picked. */
  const instant = useMemo(
    () => (isLive ? now : zonedDateTimeToInstant(viewDate, anchorZone, viewMinutes)),
    [isLive, now, viewDate, anchorZone, viewMinutes],
  );

  /**
   * Same wall-clock time, but today. Comparing the two offsets is what surfaces
   * daylight saving: if a city sits at a different offset on the viewed date
   * than it does today, the gap between you and them has moved.
   */
  const anchorOffsetToday = offsetMinutes(now, anchorZone);
  const anchorOffsetViewed = offsetMinutes(instant, anchorZone);

  async function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?${s.query}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      window.history.replaceState(null, '', url);
    }
  }

  if (!s.anchor) return null;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ scrubber */}
      <section className="rounded-2xl border border-paper-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-paper-500 uppercase">
              {isLive ? 'Right now' : `In ${s.anchor.label}`}
            </p>
            <p className="nums mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">
              {formatMinutes(viewMinutes, hour12)}
              <span className="ml-2 text-sm font-normal text-paper-500">in {s.anchor.label}</span>
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {!isLive && (
              <button
                type="button"
                onClick={() => {
                  s.setMeetingMinutes(null);
                  s.setDate(null);
                }}
                className="ring-focus rounded-md bg-paper-900 px-2.5 py-1 text-xs font-medium text-paper-50"
              >
                Back to now
              </button>
            )}
            <button
              type="button"
              onClick={() => setHour12((v) => !v)}
              className="ring-focus rounded-md border border-paper-200 px-2 py-1 text-xs text-paper-500 hover:text-paper-900"
            >
              {hour12 ? '12h' : '24h'}
            </button>
          </div>
        </div>

        <label className="mt-3 block">
          <span className="sr-only">Pick a time in {s.anchor.label}</span>
          <input
            type="range"
            min={0}
            max={1425}
            step={15}
            value={viewMinutes}
            onChange={(e) => s.setMeetingMinutes(Number(e.target.value))}
            className="ring-focus w-full accent-go-500"
          />
        </label>
        <div className="nums flex justify-between text-[10px] text-paper-500">
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h}>{formatMinutes((h % 24) * 60, hour12)}</span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-paper-100 pt-3">
          <DateControl
            date={s.date}
            today={today}
            onChange={s.setDate}
            label={`Date in ${s.anchor.label}`}
          />
        </div>

        {anchorOffsetViewed !== anchorOffsetToday ? (
          <p className="mt-2 text-[11px] leading-relaxed text-warn-700">
            On this date {s.anchor.label} is on {formatOffset(anchorOffsetViewed)} rather than
            today's {formatOffset(anchorOffsetToday)}, so its gap to every other city has moved by{' '}
            {formatHours(Math.abs(anchorOffsetViewed - anchorOffsetToday))}.
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-paper-500">
            Pick a date to see how daylight saving changes these gaps &mdash; they are not fixed.
          </p>
        )}
      </section>

      {/* --------------------------------------------------------------- cities */}
      <ul className="space-y-2">
        {s.participants.map((p, index) => (
          <CityRow
            key={p.id}
            index={index}
            total={s.participants.length}
            participant={p}
            instant={instant}
            now={now}
            viewerZone={viewerZone!}
            anchorZone={s.anchor.timeZone}
            isAnchor={index === s.anchorIndex}
            hour12={hour12}
            onSetAnchor={() => s.setAnchor(index)}
            onRemove={() => s.remove(p.id)}
            onMove={(dir) => s.move(p.id, dir)}
            onRename={(label) => s.update(p.id, { label })}
          />
        ))}
      </ul>

      <CityPicker onAdd={(city) => s.add(city.timeZone, city.name)} />

      {/* ---------------------------------------------------------------- links */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="ring-focus rounded-lg bg-paper-900 px-4 py-2 text-sm font-medium text-paper-50 hover:opacity-90"
        >
          {copied ? 'Link copied' : 'Copy this clock as a link'}
        </button>
        <a
          href={`/overlap?${s.query}`}
          className="ring-focus rounded-lg border border-paper-200 bg-white px-4 py-2 text-sm font-medium text-paper-700 hover:border-paper-300"
        >
          Find a meeting time &rarr;
        </a>
      </div>
      <p className="text-[11px] text-paper-500">
        These cities travel with you to the meeting planner &mdash; you never have to enter them
        twice.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- row */

function CityRow({
  index,
  total,
  participant,
  instant,
  now,
  viewerZone,
  anchorZone,
  isAnchor,
  hour12,
  onSetAnchor,
  onRemove,
  onMove,
  onRename,
}: {
  index: number;
  total: number;
  participant: { id: string; label: string; timeZone: string };
  instant: Date;
  /** The live clock, for comparing the viewed date's offset against today's. */
  now: Date;
  viewerZone: string;
  anchorZone: string;
  isAnchor: boolean;
  hour12: boolean;
  onSetAnchor: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onRename: (label: string) => void;
}) {
  const { timeZone, label } = participant;
  const lat = latitudeFor(timeZone, label);

  const parts = zonedParts(instant, timeZone);
  const minutes = parts.hour * 60 + parts.minute;
  const sky = skyState(instant, timeZone, lat);

  const offsetHere = offsetMinutes(instant, timeZone);
  const offsetViewer = offsetMinutes(instant, viewerZone);
  const relative = offsetHere - offsetViewer;

  /**
   * Whether this city's own offset on the viewed date differs from today's.
   * This is the whole reason the date picker exists, so it earns a visible badge
   * rather than being left for the user to infer from the numbers.
   */
  const offsetShift = offsetHere - offsetMinutes(now, timeZone);

  const dayShift = calendarDayShift(instant, timeZone, anchorZone);

  /** 24h sky strip for this city's local day. Recomputed once a day, not per tick. */
  const strip = useMemo(() => {
    if (lat === undefined) return null;
    const midnight = zonedDateTimeToInstant(
      formatIsoDate(parts.year, parts.month, parts.day),
      timeZone,
      0,
    );
    return Array.from({ length: STRIP_STEPS }, (_, i) => {
      const at = new Date(midnight.getTime() + i * (1440 / STRIP_STEPS) * 60_000);
      return skyState(at, timeZone, lat).state;
    });
  }, [timeZone, lat, parts.year, parts.month, parts.day]);

  return (
    <li className="rounded-xl border border-paper-200 bg-white">
      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
        {/* reorder */}
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Move ${label} up`}
            className="ring-focus px-1 text-[9px] leading-tight text-paper-500 hover:text-paper-900 disabled:opacity-25"
          >
            &#9650;
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={`Move ${label} down`}
            className="ring-focus px-1 text-[9px] leading-tight text-paper-500 hover:text-paper-900 disabled:opacity-25"
          >
            &#9660;
          </button>
        </div>

        <SkyDot state={sky.state} />

        {/* name + offset */}
        <div className="min-w-0 flex-1">
          <input
            value={label}
            onChange={(e) => onRename(e.target.value.slice(0, 40))}
            aria-label={`Name for ${label}`}
            className="ring-focus w-full truncate rounded border border-transparent bg-transparent text-sm font-medium hover:border-paper-200"
          />
          <p className="nums text-[11px] text-paper-500">
            {formatOffset(offsetHere)}
            {relative !== 0 && (
              <span className="ml-1.5">
                {relative > 0 ? '+' : '−'}
                {formatHours(Math.abs(relative))} from you
              </span>
            )}
            {offsetShift !== 0 && (
              <span className="ml-1.5 rounded bg-warn-100 px-1 py-px font-medium text-warn-700">
                {offsetShift > 0 ? '+' : '−'}
                {formatHours(Math.abs(offsetShift))} vs today
              </span>
            )}
            {sky.approximate && <span className="ml-1.5 opacity-70">· sky estimated</span>}
          </p>
        </div>

        {/* time */}
        <div className="shrink-0 text-right">
          <p className="nums text-xl font-semibold tabular-nums">
            {formatMinutes(minutes, hour12)}
          </p>
          <p className="text-[11px] text-paper-500">
            {new Intl.DateTimeFormat('en', {
              timeZone,
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            }).format(instant)}
            {dayShift !== 0 && (
              <span className="ml-1 font-medium">{dayShift > 0 ? 'next day' : 'prev day'}</span>
            )}
          </p>
        </div>

        {/* actions */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onSetAnchor}
            title="Use this city's clock for the slider"
            className={`ring-focus rounded px-1.5 py-0.5 text-[10px] ${
              isAnchor ? 'bg-paper-900 text-paper-50' : 'text-paper-500 hover:text-paper-900'
            }`}
          >
            {isAnchor ? 'base' : 'set base'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={total === 1}
            aria-label={`Remove ${label}`}
            className="ring-focus rounded p-1 text-paper-500 hover:text-paper-900 disabled:opacity-25"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M3 3l6 6m0-6l-6 6"
                stroke="currentColor"
                strokeWidth="1.7"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* sky strip: where in their daylight this moment sits */}
      {strip && (
        <div className="relative mx-3 mb-2.5 h-1.5 overflow-hidden rounded-full sm:mx-4">
          <div className="flex h-full">
            {strip.map((state, i) => (
              <div key={i} className={`flex-1 ${SKY_CLASS[state]}`} />
            ))}
          </div>
          <div
            className="absolute top-0 h-full w-0.5 bg-paper-900"
            style={{ left: `calc(${(minutes / 1440) * 100}% - 1px)` }}
            aria-hidden="true"
          />
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------- helpers */

function SkyDot({ state }: { state: SkyState }) {
  const title = state === 'day' ? 'Daylight' : state === 'twilight' ? 'Twilight' : 'Dark';
  return (
    <span
      title={title}
      aria-label={title}
      role="img"
      className={`h-6 w-6 shrink-0 rounded-full border ${
        state === 'day'
          ? 'border-sky-day bg-sky-day'
          : state === 'twilight'
            ? 'border-sky-dusk bg-sky-dusk'
            : 'border-paper-300 bg-sky-night'
      }`}
    />
  );
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

/** Local calendar day difference against the base city: -1, 0 or +1. */
function calendarDayShift(instant: Date, timeZone: string, baseZone: string): number {
  const a = zonedParts(instant, timeZone);
  const b = zonedParts(instant, baseZone);
  const dayA = Date.UTC(a.year, a.month - 1, a.day);
  const dayB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((dayA - dayB) / 86_400_000);
}
