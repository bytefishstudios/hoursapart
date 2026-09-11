import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

/** Theme variables, so the strip re-themes with the rest of the site. */
const SKY_VAR: Record<SkyState, string> = {
  day: 'var(--color-sky-day)',
  twilight: 'var(--color-sky-dusk)',
  night: 'var(--color-sky-night)',
};

export default function WorldClock() {
  const s = useScenario();
  const [now, setNow] = useState(() => new Date());
  const [hour12, setHour12] = useState(false);
  const [copied, setCopied] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
  const anchorParts = zonedParts(instant, anchorZone);
  const anchorLat = latitudeFor(anchorZone, s.anchor?.label);
  const anchorSky = skyState(instant, anchorZone, anchorLat);
  const anchorStrip = useMemo(
    () => buildSkyStrip(anchorParts, anchorZone, anchorLat),
    [anchorZone, anchorLat, anchorParts.year, anchorParts.month, anchorParts.day],
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

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id || !s.anchor) return;

    const visible = s.participants.filter((participant) => participant.id !== s.anchor.id);
    const from = visible.findIndex((participant) => participant.id === event.active.id);
    const target = visible.findIndex((participant) => participant.id === event.over?.id);
    if (from < 0 || target < 0 || from === target) return;

    s.reorder(String(event.active.id), target);
  }

  if (!s.anchor) return null;

  const visibleRows = s.participants
    .map((participant, originalIndex) => ({ participant, originalIndex }))
    .filter(({ participant }) => participant.id !== s.anchor.id);

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ scrubber */}
      <section className="clock-console overflow-hidden rounded-[1.75rem] border border-paper-900 bg-paper-900 text-paper-50 elev-lift">
        <div className="p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                {isLive && <span className="h-2 w-2 rounded-full bg-go-500" aria-hidden="true" />}
                <p className="text-[11px] font-semibold tracking-[0.16em] text-paper-300 uppercase">
                  {isLive ? 'Live in your base city' : `Previewing ${s.anchor.label}`}
                </p>
              </div>
              <p className="nums mt-2 text-5xl font-semibold tracking-[-0.045em] tabular-nums sm:text-6xl">
                {formatMinutes(viewMinutes, hour12)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-paper-300">
                <input
                  value={s.anchor.label}
                  onChange={(event) =>
                    s.update(s.anchor.id, { label: event.target.value.slice(0, 40) })
                  }
                  aria-label="Base city name"
                  className="ring-focus min-w-0 max-w-48 rounded-lg border border-paper-700/50 bg-paper-50/10 px-2 py-1 font-semibold text-paper-50"
                />
                <span>sets the clock for every city below</span>
                <button
                  type="button"
                  onClick={() => s.remove(s.anchor.id)}
                  disabled={s.participants.length === 1}
                  aria-label={`Remove base city ${s.anchor.label}`}
                  className="ring-focus rounded-lg border border-paper-700/50 px-2 py-1 text-[10px] font-semibold text-paper-300 hover:border-paper-300 hover:text-paper-50 disabled:opacity-25"
                >
                  Remove
                </button>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-paper-300">
                <SkyDot state={anchorSky.state} />
                <span>
                  {skyLabel(anchorSky.state)} in {s.anchor.label}
                  {anchorSky.approximate ? ' · estimated' : ''}
                </span>
              </div>
              {anchorStrip && (
                <div
                  className="sky-strip relative mt-3 h-3 w-full max-w-sm overflow-hidden rounded-full ring-1 ring-paper-50/15"
                  style={{ '--sky-stops': anchorStrip } as CSSProperties}
                  role="img"
                  aria-label={`${s.anchor.label}'s daylight pattern; marker at ${formatMinutes(viewMinutes, hour12)}`}
                >
                  <div
                    className="absolute top-0 h-full w-0.5 rounded-full bg-paper-50"
                    style={{ left: `calc(${(viewMinutes / 1440) * 100}% - 1px)` }}
                    aria-hidden="true"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isLive && (
                <button
                  type="button"
                  onClick={() => {
                    s.setMeetingMinutes(null);
                    s.setDate(null);
                  }}
                  className="ring-focus h-9 rounded-lg bg-paper-50 px-3 text-xs font-semibold text-paper-900"
                >
                  Back to now
                </button>
              )}
              <div
                role="group"
                aria-label="Time format"
                className="flex rounded-lg border border-paper-700/40 bg-paper-50/10 p-0.5"
              >
                {[false, true].map((use12) => (
                  <button
                    key={String(use12)}
                    type="button"
                    aria-pressed={hour12 === use12}
                    onClick={() => setHour12(use12)}
                    className={`ring-focus rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      hour12 === use12
                        ? 'bg-paper-50 text-paper-900'
                        : 'text-paper-300 hover:text-paper-50'
                    }`}
                  >
                    {use12 ? '12h' : '24h'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="mt-7 block">
            <span className="sr-only">Pick a time in {s.anchor.label}</span>
            <input
              type="range"
              min={0}
              max={1425}
              step={15}
              value={viewMinutes}
              onChange={(e) => s.setMeetingMinutes(Number(e.target.value))}
              className="slider"
              aria-valuetext={`${formatMinutes(viewMinutes, hour12)} in ${s.anchor.label}`}
            />
          </label>
          <div className="nums flex justify-between text-[10px] text-paper-300">
            {[0, 6, 12, 18, 24].map((h) => (
              <span key={h}>{formatMinutes((h % 24) * 60, hour12)}</span>
            ))}
          </div>
        </div>

        <div className="border-t border-paper-700/30 bg-paper-50 p-3 text-paper-900 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:px-5">
          <DateControl
            date={s.date}
            today={today}
            onChange={s.setDate}
            label={`Date in ${s.anchor.label}`}
          />

          {anchorOffsetViewed !== anchorOffsetToday ? (
            <p className="mt-2 max-w-md text-[11px] leading-relaxed text-warn-700 sm:mt-0 sm:text-right">
              On this date, {s.anchor.label}&rsquo;s offset moves by{' '}
              {formatHours(Math.abs(anchorOffsetViewed - anchorOffsetToday))}. Every gap below
              updates.
            </p>
          ) : (
            <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-paper-500 sm:mt-0 sm:text-right">
              Choose a future date to reveal daylight-saving drift.
            </p>
          )}
        </div>
      </section>

      {/* --------------------------------------------------------------- cities */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Other cities</h2>
          <p className="mt-0.5 text-xs text-paper-500">
            Drag a grip to arrange the cities, or set a different base clock.
          </p>
        </div>
        <span className="text-[11px] text-paper-500">Base city stays in the main clock above</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={visibleRows.map(({ participant }) => participant.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {visibleRows.map(({ participant, originalIndex }, visibleIndex) => (
              <CityRow
                key={participant.id}
                index={visibleIndex}
                total={visibleRows.length}
                canRemove={s.participants.length > 1}
                participant={participant}
                instant={instant}
                now={now}
                viewerZone={viewerZone!}
                anchorZone={s.anchor.timeZone}
                anchorLabel={s.anchor.label}
                hour12={hour12}
                onSetAnchor={() => s.setAnchor(originalIndex)}
                onRemove={() => s.remove(participant.id)}
                onRename={(label) => s.update(participant.id, { label })}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <CityPicker onAdd={(city) => s.add(city.timeZone, city.name)} />

      {/* ---------------------------------------------------------------- links */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="ring-focus rounded-xl bg-paper-900 px-4 py-2.5 text-sm font-medium text-paper-50 elev elev-hover"
        >
          {copied ? 'Link copied' : 'Copy this clock as a link'}
        </button>
        <a
          href={`/overlap?${s.query}`}
          className="ring-focus rounded-xl border border-paper-200 bg-white px-4 py-2.5 text-sm font-medium text-paper-700 elev transition-shadow hover:border-paper-300 hover:elev-lift"
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
  canRemove,
  participant,
  instant,
  now,
  viewerZone,
  anchorZone,
  anchorLabel,
  hour12,
  onSetAnchor,
  onRemove,
  onRename,
}: {
  index: number;
  total: number;
  canRemove: boolean;
  participant: { id: string; label: string; timeZone: string };
  instant: Date;
  /** The live clock, for comparing the viewed date's offset against today's. */
  now: Date;
  viewerZone: string;
  anchorZone: string;
  anchorLabel: string;
  hour12: boolean;
  onSetAnchor: () => void;
  onRemove: () => void;
  onRename: (label: string) => void;
}) {
  const { timeZone, label } = participant;
  const lat = latitudeFor(timeZone, label);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: participant.id,
    disabled: total < 2,
  });
  const sortableStyle: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 20 : undefined,
    willChange: 'transform',
  };

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
  const relativeDay =
    dayShift === -1
      ? 'Yesterday'
      : dayShift === 0
        ? 'Today'
        : dayShift === 1
          ? 'Tomorrow'
          : dayShift < 0
            ? `${Math.abs(dayShift)} days behind`
            : `${dayShift} days ahead`;
  const localDate = new Intl.DateTimeFormat('en', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(instant);

  /**
   * This city's local day as CSS gradient stops, rather than a row of abutted
   * blocks. Emitting one stop per sample lets the browser interpolate, so dawn
   * and dusk actually look like transitions instead of steps. Recomputed once a
   * day, not per tick.
   */
  const strip = useMemo(
    () => buildSkyStrip(parts, timeZone, lat),
    [timeZone, lat, parts.year, parts.month, parts.day],
  );

  return (
    <li
      ref={setNodeRef}
      style={sortableStyle}
      data-reorder-row
      className={`city-clock-row overflow-hidden rounded-2xl border bg-white transition-[border-color,box-shadow,opacity] ${
        isDragging
          ? 'is-dragging border-go-500 opacity-95 elev-lift'
          : 'border-paper-200 elev elev-hover'
      }`}
    >
      <div className="city-row-layout p-4 sm:px-5">
        <button
          type="button"
          data-reorder-handle
          disabled={total < 2}
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          aria-label={`Drag to reorder ${label}, position ${index + 1} of ${total}`}
          className="city-row-handle reorder-handle ring-focus flex h-11 w-11 items-center justify-center rounded-xl border border-paper-200 text-paper-500 hover:border-paper-300 hover:bg-paper-50 hover:text-paper-900 disabled:cursor-default disabled:opacity-30"
        >
          <svg width="16" height="22" viewBox="0 0 16 22" aria-hidden="true">
            <circle cx="5" cy="4" r="1.5" fill="currentColor" />
            <circle cx="11" cy="4" r="1.5" fill="currentColor" />
            <circle cx="5" cy="11" r="1.5" fill="currentColor" />
            <circle cx="11" cy="11" r="1.5" fill="currentColor" />
            <circle cx="5" cy="18" r="1.5" fill="currentColor" />
            <circle cx="11" cy="18" r="1.5" fill="currentColor" />
          </svg>
        </button>

        <div className="city-row-sky-dot pt-0.5">
          <SkyDot state={sky.state} />
        </div>

        <div className="city-row-identity min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <input
              value={label}
              onChange={(e) => onRename(e.target.value.slice(0, 40))}
              aria-label={`Name for ${label}`}
              className="ring-focus min-w-0 flex-1 truncate rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold hover:border-paper-200"
            />
          </div>
          <p className="nums mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-paper-500">
            <span>UTC{formatOffset(offsetHere)}</span>
            {relative !== 0 && (
              <span>
                {relative > 0 ? '+' : '−'}
                {formatHours(Math.abs(relative))} from you
              </span>
            )}
            {offsetShift !== 0 && (
              <span className="rounded-md bg-warn-100 px-1.5 py-0.5 font-semibold text-warn-700">
                {offsetShift > 0 ? '+' : '−'}
                {formatHours(Math.abs(offsetShift))} vs today
              </span>
            )}
            {sky.approximate && <span className="opacity-70">sky estimated</span>}
          </p>
        </div>

        <div className="city-row-time text-right">
          <p className="nums text-2xl font-semibold tracking-tight tabular-nums">
            {formatMinutes(minutes, hour12)}
          </p>
        </div>

        <div
          className="city-row-day flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper-50 px-3 py-2 sm:justify-end sm:bg-transparent sm:p-0"
          data-day-shift={dayShift}
        >
          <span data-local-date className="text-sm font-semibold text-paper-900">
            {localDate}
          </span>
          <span
            title={`${relativeDay} relative to ${anchorLabel}`}
            aria-label={`${relativeDay} relative to base city ${anchorLabel}`}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              dayShift === 0
                ? 'bg-paper-100 text-paper-700'
                : 'bg-warn-100 text-warn-700 ring-1 ring-warn-700/15'
            }`}
          >
            {relativeDay}
          </span>
        </div>

        <div className="city-row-actions flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onSetAnchor}
            title="Use this city's clock for the slider"
            className="ring-focus h-9 rounded-lg border border-paper-200 px-3 text-[11px] font-semibold text-paper-700 hover:border-paper-300"
          >
            Set as base
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            aria-label={`Remove ${label}`}
            className="ring-focus flex h-9 w-9 items-center justify-center rounded-lg border border-paper-200 text-paper-500 hover:border-paper-300 hover:text-paper-900 disabled:opacity-25"
          >
            <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
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

        {strip && (
          <div
            className="city-row-strip sky-strip relative h-3 overflow-hidden rounded-full"
            style={{ '--sky-stops': strip } as CSSProperties}
            role="img"
            aria-label={`${label}'s daylight pattern; marker at ${formatMinutes(minutes, hour12)}`}
          >
            <div
              className="sky-marker absolute top-0 h-full w-0.5 rounded-full bg-paper-900"
              style={{ left: `calc(${(minutes / 1440) * 100}% - 1px)` }}
              aria-hidden="true"
            />
          </div>
        )}
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- helpers */

function buildSkyStrip(
  parts: ReturnType<typeof zonedParts>,
  timeZone: string,
  lat: number | undefined,
): string | null {
  if (lat === undefined) return null;
  const midnight = zonedDateTimeToInstant(
    formatIsoDate(parts.year, parts.month, parts.day),
    timeZone,
    0,
  );
  return Array.from({ length: STRIP_STEPS + 1 }, (_, index) => {
    const at = new Date(midnight.getTime() + index * (1440 / STRIP_STEPS) * 60_000);
    const { state } = skyState(at, timeZone, lat);
    return `${SKY_VAR[state]} ${((index / STRIP_STEPS) * 100).toFixed(2)}%`;
  }).join(', ');
}

function skyLabel(state: SkyState): string {
  return state === 'day' ? 'Daylight' : state === 'twilight' ? 'Twilight' : 'Night';
}

function SkyDot({ state }: { state: SkyState }) {
  const title = skyLabel(state);
  /*
   * Every sky state gets the same soft outer-ring treatment: warm daylight,
   * muted dusk and a slightly stronger dark halo for night.
   */
  const ring =
    state === 'day'
      ? 'border-sky-day bg-sky-day shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-sky-day)_28%,transparent)]'
      : state === 'twilight'
        ? 'border-sky-dusk bg-sky-dusk shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-sky-dusk)_24%,transparent)]'
        : 'border-sky-night bg-sky-night shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-sky-night)_35%,transparent)]';

  return (
    <span
      title={title}
      aria-label={title}
      role="img"
      className={`h-6 w-6 shrink-0 rounded-full border ${ring}`}
    />
  );
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

/** Local calendar day difference against the base city, including date-line extremes. */
function calendarDayShift(instant: Date, timeZone: string, baseZone: string): number {
  const a = zonedParts(instant, timeZone);
  const b = zonedParts(instant, baseZone);
  const dayA = Date.UTC(a.year, a.month - 1, a.day);
  const dayB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((dayA - dayB) / 86_400_000);
}
