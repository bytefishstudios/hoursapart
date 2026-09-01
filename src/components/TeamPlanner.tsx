import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_WORK_DAYS, isAvailable, type Participant } from '../lib/time/overlap';
import { projectMeeting } from '../lib/time/dst';
import { useScenario } from '../lib/time/useScenario';
import {
  formatIsoDateLong,
  formatMinutes,
  formatOffset,
  offsetMinutes,
  toIsoDate,
  zonedDateTimeToInstant,
  zonedParts,
} from '../lib/time/zone';
import CityPicker from './CityPicker';
import DateControl from './DateControl';

/** Half-hour resolution: fine enough for real scheduling, cheap enough to render. */
const SLOTS = 48;
const SLOT_MINUTES = 30;
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function TeamPlanner() {
  const s = useScenario();
  const [now, setNow] = useState(() => new Date());
  const [hour12, setHour12] = useState(false);
  const [copied, setCopied] = useState<'link' | 'text' | null>(null);

  // Only so "today" stays correct if the page is left open past midnight. The
  // grid does not depend on the seconds, and `today` is a string, so this
  // causes no recomputation until the date actually rolls over.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const anchorZone = s.anchor?.timeZone ?? 'UTC';
  const today = toIsoDate(now, anchorZone);
  const viewDate = s.date ?? today;

  /** Midnight in the base city, on the viewed day, as a UTC instant. */
  const dayStart = useMemo(
    () => zonedDateTimeToInstant(viewDate, anchorZone, 0),
    [viewDate, anchorZone],
  );

  /** One column per half hour of the base city's local day. */
  const columns = useMemo(() => {
    if (!s.anchor) return [];
    return Array.from({ length: SLOTS }, (_, i) => {
      const at = new Date(dayStart.getTime() + i * SLOT_MINUTES * 60_000);
      const availableIds = s.participants.filter((p) => isAvailable(p, at)).map((p) => p.id);
      return {
        at,
        baseMinutes: i * SLOT_MINUTES,
        availableIds,
        everyone: availableIds.length === s.participants.length && s.participants.length > 0,
      };
    });
  }, [s.anchor, dayStart, s.participants]);

  const fullOverlapSlots = columns.filter((c) => c.everyone).length;

  /**
   * When nothing suits everybody, "nothing" is a useless answer. Sydney and
   * London genuinely never share business hours, so the tool would dead-end on
   * a perfectly ordinary team. The useful answer is the longest stretch that
   * suits the most people, plus the name of whoever has to stretch — which is
   * what a team picks anyway, by hand, staring at a grid.
   */
  const best = useMemo(() => {
    if (columns.length === 0 || s.participants.length === 0) return null;
    const max = Math.max(...columns.map((c) => c.availableIds.length));
    if (max === 0 || max === s.participants.length) return null;

    // Walk runs of identical availability, keeping the longest at the maximum.
    let run: { start: number; length: number; ids: string[] } | null = null;
    let i = 0;
    while (i < columns.length) {
      const key = columns[i].availableIds.join(',');
      let j = i;
      while (j + 1 < columns.length && columns[j + 1].availableIds.join(',') === key) j += 1;
      const length = j - i + 1;
      if (columns[i].availableIds.length === max && (run === null || length > run.length)) {
        run = { start: i, length, ids: columns[i].availableIds };
      }
      i = j + 1;
    }
    if (run === null) return null;

    return {
      count: max,
      startMinutes: run.start * SLOT_MINUTES,
      endMinutes: (run.start + run.length) * SLOT_MINUTES,
      missing: s.participants.filter((p) => !run.ids.includes(p.id)),
    };
  }, [columns, s.participants]);

  const meetingAt = useMemo(() => {
    if (s.meetingMinutes === null) return null;
    return zonedDateTimeToInstant(viewDate, anchorZone, s.meetingMinutes);
  }, [viewDate, anchorZone, s.meetingMinutes]);

  /** The differentiator: which weeks will daylight saving move this meeting? */
  const shifts = useMemo(() => {
    if (!s.anchor || s.meetingMinutes === null) return [];
    return projectMeeting(s.participants, s.anchor.id, s.meetingMinutes, dayStart, 60).shifts.slice(
      0,
      5,
    );
  }, [s.anchor, s.participants, s.meetingMinutes, dayStart]);

  async function copy(kind: 'link' | 'text') {
    const value =
      kind === 'link'
        ? `${window.location.origin}${window.location.pathname}?${s.query}`
        : plainTextSummary(s.participants, meetingAt, hour12);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2400);
    } catch {
      if (kind === 'link') window.history.replaceState(null, '', value);
    }
  }

  if (!s.anchor) return null;

  return (
    <div className="space-y-7">
      {/* ------------------------------------------------------------ headline */}
      <section aria-live="polite" className="rounded-2xl border border-paper-200 bg-white p-5">
        {fullOverlapSlots > 0 ? (
          <>
            <p className="text-xs font-medium tracking-wide text-paper-500 uppercase">
              Everyone is free for
            </p>
            <p className="nums mt-1 text-3xl font-semibold tracking-tight">
              {formatDuration(fullOverlapSlots * SLOT_MINUTES)}
            </p>
            <p className="mt-1 text-sm text-paper-500">
              on {formatIsoDateLong(viewDate)} &middot; click the darker green to pick a time
            </p>
          </>
        ) : best ? (
          <>
            <p className="text-xs font-medium tracking-wide text-paper-500 uppercase">
              No hour suits everyone
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              Closest is {best.count} of {s.participants.length}, for{' '}
              {formatDuration(best.endMinutes - best.startMinutes)}
            </p>
            <p className="nums mt-1 text-sm text-paper-500">
              {formatMinutes(best.startMinutes, hour12)}&ndash;
              {formatMinutes(best.endMinutes % 1440, hour12)} in {s.anchor.label}
              <span className="font-sans">
                {', with '}
                {joinNames(best.missing.map((p) => p.label))} outside their hours.
              </span>
            </p>
            <button
              type="button"
              onClick={() => s.setMeetingMinutes(best.startMinutes)}
              className="ring-focus mt-3 rounded-lg border border-paper-200 bg-white px-3 py-1.5 text-xs font-medium text-paper-700 hover:border-paper-300"
            >
              Use this slot
            </button>
          </>
        ) : (
          <>
            <p className="text-xs font-medium tracking-wide text-paper-500 uppercase">
              Nobody is free
            </p>
            <p className="mt-1 text-lg font-medium">
              No one is inside their working hours on this day.
            </p>
            <p className="mt-1 text-sm text-paper-500">
              It is likely a weekend for everybody. Try the next day, or switch a working day on
              below.
            </p>
          </>
        )}
      </section>

      {/* ---------------------------------------------------------------- grid */}
      <section aria-labelledby="grid-heading" className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="grid-heading" className="text-sm font-semibold">
            {formatIsoDateLong(viewDate)}
          </h2>
          <div className="flex items-center gap-1">
            <DateControl
              date={s.date}
              today={today}
              onChange={s.setDate}
              label={`Date in ${s.anchor.label}`}
            />
            <button
              type="button"
              onClick={() => setHour12((v) => !v)}
              className="ring-focus ml-1 rounded-md border border-paper-200 px-2 py-1 text-xs text-paper-500 hover:text-paper-900"
            >
              {hour12 ? '12h' : '24h'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-paper-200 bg-white">
          <div className="min-w-[46rem]">
            <div className="flex border-b border-paper-100 pl-40">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="nums flex-1 border-l border-paper-100 py-1 text-center text-[10px] text-paper-500"
                >
                  {h % 3 === 0 ? formatMinutes(h * 60, hour12).replace(':00', '') : ''}
                </div>
              ))}
            </div>

            {s.participants.map((p) => (
              <Row
                key={p.id}
                participant={p}
                columns={columns}
                isAnchor={p.id === s.anchor.id}
                hour12={hour12}
                meetingAt={meetingAt}
                onPick={(minutes) => s.setMeetingMinutes(minutes)}
              />
            ))}
          </div>
        </div>

        <p className="text-[11px] text-paper-500">
          Columns follow <strong className="font-medium">{s.anchor.label}</strong>'s clock. Each row
          shows that person's own local time.
        </p>
      </section>

      {/* -------------------------------------------------------------- people */}
      <section aria-labelledby="people-heading" className="space-y-2.5">
        <h2 id="people-heading" className="text-sm font-semibold">
          Working hours
        </h2>

        <ul className="space-y-2">
          {s.participants.map((p, index) => (
            <li key={p.id} className="rounded-xl border border-paper-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <input
                  value={p.label}
                  onChange={(e) => s.update(p.id, { label: e.target.value.slice(0, 40) })}
                  aria-label={`Name for ${p.label}`}
                  className="ring-focus w-24 rounded-md border border-transparent bg-paper-100 px-2 py-1 text-sm font-medium hover:border-paper-200"
                />
                <span className="nums text-[11px] text-paper-500">
                  {formatOffset(offsetMinutes(dayStart, p.timeZone))}
                </span>

                <div className="ml-auto flex items-center gap-1">
                  <TimeSelect
                    value={p.workStart}
                    hour12={hour12}
                    onChange={(v) => s.update(p.id, { workStart: v })}
                    label={`Work start for ${p.label}`}
                  />
                  <span aria-hidden="true" className="text-xs text-paper-500">
                    &ndash;
                  </span>
                  <TimeSelect
                    value={p.workEnd}
                    hour12={hour12}
                    onChange={(v) => s.update(p.id, { workEnd: v })}
                    label={`Work end for ${p.label}`}
                  />
                </div>

                <div className="flex gap-0.5" role="group" aria-label={`Work days for ${p.label}`}>
                  {DAY_LABELS.map((d, day) => {
                    const on = (p.workDays ?? DEFAULT_WORK_DAYS).includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]} for ${p.label}`}
                        onClick={() => {
                          const days = new Set(p.workDays ?? DEFAULT_WORK_DAYS);
                          if (days.has(day)) days.delete(day);
                          else days.add(day);
                          s.update(p.id, { workDays: [...days].sort() });
                        }}
                        className={`ring-focus h-6 w-6 rounded text-[10px] font-medium transition-colors ${
                          on
                            ? 'bg-paper-900 text-paper-50'
                            : 'bg-paper-100 text-paper-500 hover:bg-paper-200'
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => s.setAnchor(index)}
                  title="Pin the meeting to this person's local clock"
                  className={`ring-focus rounded-md px-2 py-1 text-[10px] transition-colors ${
                    p.id === s.anchor.id
                      ? 'bg-paper-900 text-paper-50'
                      : 'text-paper-500 hover:text-paper-900'
                  }`}
                >
                  {p.id === s.anchor.id ? 'base' : 'set base'}
                </button>

                <button
                  type="button"
                  onClick={() => s.remove(p.id)}
                  disabled={s.participants.length === 1}
                  aria-label={`Remove ${p.label}`}
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
            </li>
          ))}
        </ul>

        <CityPicker
          onAdd={(city) => s.add(city.timeZone, city.name)}
          placeholder="Add someone — city, airport code, or country"
        />
      </section>

      {/* ------------------------------------------------- chosen time + DST */}
      {meetingAt && (
        <section aria-labelledby="meeting-heading" className="space-y-3">
          <h2 id="meeting-heading" className="text-sm font-semibold">
            {formatMinutes(s.meetingMinutes!, hour12)} in {s.anchor.label}
          </h2>

          <ul className="divide-y divide-paper-100 rounded-xl border border-paper-200 bg-white">
            {s.participants.map((p) => {
              const parts = zonedParts(meetingAt, p.timeZone);
              const shift = calendarDayShift(meetingAt, p.timeZone, s.anchor.timeZone);
              const inHours = isAvailable(p, meetingAt);
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="truncate">{p.label}</span>
                  <span className="nums flex items-center gap-2">
                    {!inHours && (
                      <span className="rounded bg-warn-100 px-1.5 py-0.5 text-[10px] text-warn-700">
                        outside hours
                      </span>
                    )}
                    <span className="font-medium">
                      {formatMinutes(parts.hour * 60 + parts.minute, hour12)}
                    </span>
                    {shift !== 0 && (
                      <span className="text-[11px] text-paper-500">
                        {shift > 0 ? 'next day' : 'prev day'}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {shifts.length > 0 ? (
            <div className="rounded-xl border border-warn-400/40 bg-warn-100/50 p-4">
              <p className="text-xs font-semibold tracking-wide text-warn-700 uppercase">
                Daylight saving will move this meeting
              </p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {shifts.map((shift) => (
                  <li key={shift.from.toISOString()}>
                    <span className="font-medium">{formatShiftDate(shift.from)}</span>
                    <span className="text-paper-700">
                      {' — '}
                      {shift.changes
                        .map(
                          (c) =>
                            `${c.label} becomes ${formatMinutes(c.afterMinutes, hour12)}, was ${formatMinutes(c.beforeMinutes, hour12)}`,
                        )
                        .join('; ')}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-warn-700">
                Countries change clocks on different weekends and in opposite directions, so a
                recurring call across hemispheres breaks more than twice a year. A colleague in a
                zone with no daylight saving at all &mdash; Tokyo, Kolkata, Brisbane &mdash; still
                sees their time move, because the base city moved underneath them.
              </p>
            </div>
          ) : (
            <p className="text-xs text-paper-500">
              No daylight saving change affects this meeting in the next year.
            </p>
          )}
        </section>
      )}

      {/* --------------------------------------------------------------- share */}
      <section className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => copy('link')}
          className="ring-focus rounded-lg bg-paper-900 px-4 py-2 text-sm font-medium text-paper-50 hover:opacity-90"
        >
          {copied === 'link' ? 'Link copied' : 'Copy shareable link'}
        </button>
        {meetingAt && (
          <button
            type="button"
            onClick={() => copy('text')}
            className="ring-focus rounded-lg border border-paper-200 bg-white px-4 py-2 text-sm font-medium text-paper-700 hover:border-paper-300"
          >
            {copied === 'text' ? 'Copied' : 'Copy for a calendar invite'}
          </button>
        )}
        <a
          href={`/?${s.query}`}
          className="ring-focus rounded-lg px-2 py-2 text-sm text-paper-500 hover:text-paper-900"
        >
          &larr; Back to the clock
        </a>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- row */

function Row({
  participant,
  columns,
  isAnchor,
  hour12,
  meetingAt,
  onPick,
}: {
  participant: Participant;
  columns: Array<{ at: Date; baseMinutes: number; availableIds: string[]; everyone: boolean }>;
  isAnchor: boolean;
  hour12: boolean;
  meetingAt: Date | null;
  onPick: (minutes: number) => void;
}) {
  const offset = columns.length > 0 ? offsetMinutes(columns[0].at, participant.timeZone) : 0;

  return (
    <div className="flex border-b border-paper-100 last:border-b-0">
      <div className="w-40 shrink-0 px-3 py-2">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-xs font-medium">{participant.label}</span>
          {isAnchor && <span className="text-[9px] text-paper-500">base</span>}
        </div>
        <span className="nums text-[10px] text-paper-500">{formatOffset(offset)}</span>
      </div>

      <div className="flex flex-1">
        {columns.map((col) => {
          const available = col.availableIds.includes(participant.id);
          const selected =
            meetingAt !== null &&
            Math.abs(col.at.getTime() - meetingAt.getTime()) < (SLOT_MINUTES * 60_000) / 2;
          const local = zonedParts(col.at, participant.timeZone);

          return (
            <button
              key={col.at.toISOString()}
              type="button"
              onClick={() => onPick(col.baseMinutes)}
              title={`${participant.label} ${formatMinutes(local.hour * 60 + local.minute, hour12)}`}
              aria-label={`Pick ${formatMinutes(col.baseMinutes, hour12)} — ${participant.label} ${formatMinutes(local.hour * 60 + local.minute, hour12)}`}
              className={[
                'ring-focus h-9 flex-1 border-l border-paper-100/70 transition-colors',
                col.everyone
                  ? 'bg-go-300 hover:bg-go-500'
                  : available
                    ? 'bg-go-100 hover:bg-go-300'
                    : 'bg-paper-100/60 hover:bg-paper-200',
                selected ? 'ring-2 ring-paper-900 ring-inset' : '',
              ].join(' ')}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

function TimeSelect({
  value,
  hour12,
  onChange,
  label,
}: {
  value: number;
  hour12: boolean;
  onChange: (minutes: number) => void;
  label: string;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      className="ring-focus nums rounded-md border border-paper-200 bg-white px-1 py-0.5 text-xs"
    >
      {Array.from({ length: 48 }, (_, i) => i * 30).map((m) => (
        <option key={m} value={m}>
          {formatMinutes(m, hour12)}
        </option>
      ))}
    </select>
  );
}

function calendarDayShift(instant: Date, timeZone: string, baseZone: string): number {
  const a = zonedParts(instant, timeZone);
  const b = zonedParts(instant, baseZone);
  return Math.round(
    (Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000,
  );
}

/** "Ana", "Ana and Bo", "Ana, Bo and Chi". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  return `${h}h ${m}m`;
}

function formatShiftDate(instant: Date): string {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    instant,
  );
}

/** A block to paste straight into a calendar invite or a chat. */
function plainTextSummary(
  participants: Participant[],
  meetingAt: Date | null,
  hour12: boolean,
): string {
  if (!meetingAt) return '';
  const lines = participants.map((p) => {
    const parts = zonedParts(meetingAt, p.timeZone);
    return `${p.label}: ${formatMinutes(parts.hour * 60 + parts.minute, hour12)} (${p.timeZone})`;
  });
  const iso = meetingAt.toISOString();
  return `${lines.join('\n')}\n\nUTC: ${iso.slice(11, 16)} on ${iso.slice(0, 10)}`;
}
