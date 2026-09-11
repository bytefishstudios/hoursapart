import { useEffect, useMemo, useState } from 'react';
import {
  buildIcs,
  googleCalendarUrl,
  outlookCalendarUrl,
  type CalendarEvent,
} from '../lib/time/calendar';
import {
  DEFAULT_WORK_DAYS,
  isAvailable,
  meetingCandidates,
  resolveMeetingStart,
  type MeetingCandidate,
  type Participant,
} from '../lib/time/overlap';
import { projectMeeting } from '../lib/time/dst';
import { MAX_MEETING_MINUTES, MEETING_STEP_MINUTES } from '../lib/time/share';
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

/** Quarter-hour resolution: real meetings start at 11:15, not only on the half hour. */
const SLOT_MINUTES = 15;
const SLOTS = (24 * 60) / SLOT_MINUTES;
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function TeamPlanner() {
  const s = useScenario();
  const [now, setNow] = useState(() => new Date());
  const [hour12, setHour12] = useState(false);
  const [copied, setCopied] = useState<'link' | 'text' | null>(null);
  const [origin, setOrigin] = useState('https://hoursapart.app');

  useEffect(() => setOrigin(window.location.origin), []);

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

  /**
   * The timeline answers only "is this person inside their working hours?".
   * Keep it independent from the proposed meeting length so changing Duration
   * never rewrites someone's underlying schedule.
   */
  const availabilityColumns = useMemo(
    () =>
      s.anchor
        ? meetingCandidates(s.participants, viewDate, anchorZone, SLOT_MINUTES, SLOTS, SLOT_MINUTES)
        : [],
    [s.anchor, s.participants, viewDate, anchorZone],
  );

  /** Candidate starts where participants can cover the complete meeting. */
  const meetingColumns = useMemo(
    () =>
      s.anchor
        ? meetingCandidates(
            s.participants,
            viewDate,
            anchorZone,
            s.durationMinutes,
            SLOTS,
            SLOT_MINUTES,
          )
        : [],
    [s.anchor, s.participants, viewDate, anchorZone, s.durationMinutes],
  );

  const fullOverlapSlots = meetingColumns.filter((column) => column.everyone).length;

  /**
   * Land on a concrete meeting rather than an empty outline and a "--:--" start:
   * the first slot that suits everybody, or 09:00 when nothing does. Only ever
   * applied when the link itself carries no start.
   */
  useEffect(() => {
    if (!s.hydrated || s.meetingMinutes !== null || meetingColumns.length === 0) return;
    const firstFit = meetingColumns.find((column) => column.everyone && column.valid);
    s.setMeetingMinutes(firstFit ? firstFit.baseMinutes : 9 * 60);
  }, [s.hydrated, s.meetingMinutes, s.setMeetingMinutes, meetingColumns]);

  /**
   * Mobile gets real candidate windows instead of a 46rem-wide, 192-button
   * miniature timeline. Group adjacent half-hours with identical full-meeting
   * coverage, then keep the longest useful windows.
   */
  const recommendedWindows = useMemo(() => {
    if (meetingColumns.length === 0 || s.participants.length === 0) return [];
    const targetCount =
      fullOverlapSlots > 0
        ? s.participants.length
        : Math.max(...meetingColumns.map((column) => column.availableIds.length));
    if (targetCount === 0) return [];

    const windows: Array<{
      startMinutes: number;
      endMinutes: number;
      availableIds: string[];
    }> = [];
    let start = 0;
    while (start < meetingColumns.length) {
      const key = meetingColumns[start].availableIds.join(',');
      let end = start;
      while (
        end + 1 < meetingColumns.length &&
        meetingColumns[end + 1].availableIds.join(',') === key
      ) {
        end += 1;
      }
      if (meetingColumns[start].availableIds.length === targetCount) {
        windows.push({
          startMinutes: start * SLOT_MINUTES,
          endMinutes: end * SLOT_MINUTES + s.durationMinutes,
          availableIds: meetingColumns[start].availableIds,
        });
      }
      start = end + 1;
    }

    return windows
      .sort(
        (a, b) =>
          b.endMinutes - b.startMinutes - (a.endMinutes - a.startMinutes) ||
          a.startMinutes - b.startMinutes,
      )
      .slice(0, 4);
  }, [meetingColumns, fullOverlapSlots, s.durationMinutes, s.participants]);

  const meetingAt = useMemo(() => {
    if (s.meetingMinutes === null) return null;
    return resolveMeetingStart(viewDate, anchorZone, s.meetingMinutes);
  }, [viewDate, anchorZone, s.meetingMinutes]);
  const meetingEndsAt = useMemo(
    () => (meetingAt ? new Date(meetingAt.getTime() + s.durationMinutes * 60_000) : null),
    [meetingAt, s.durationMinutes],
  );
  const selectedSummary = useMemo(() => {
    if (!meetingAt) return null;

    const coverage = s.participants.map((participant) => ({
      participant,
      minutes: meetingCoverageMinutes(participant, meetingAt, s.durationMinutes),
    }));
    const full = coverage.filter(({ minutes }) => minutes === s.durationMinutes);
    const partial = coverage.filter(({ minutes }) => minutes > 0 && minutes < s.durationMinutes);
    const covered = coverage.filter(({ minutes }) => minutes > 0);

    if (coverage.length === 1) {
      const [{ participant, minutes }] = coverage;
      if (minutes === s.durationMinutes) {
        return {
          tone: 'full' as const,
          eyebrow: 'Selected meeting',
          title: `${participant.label} is within working hours`,
          detail: `The entire selected meeting (${formatDuration(s.durationMinutes)}) is within the configured hours.`,
        };
      }
      if (minutes > 0) {
        return {
          tone: 'partial' as const,
          eyebrow: 'Selected meeting · Partial coverage',
          title: `${participant.label}: ${formatDuration(minutes)} of ${formatDuration(s.durationMinutes)}`,
          detail: `${formatDuration(s.durationMinutes - minutes)} of the selected meeting is outside working hours.`,
        };
      }
      return {
        tone: 'outside' as const,
        eyebrow: 'Selected meeting · Outside working hours',
        title: `${participant.label} is outside working hours`,
        detail: `The selected meeting (${formatDuration(s.durationMinutes)}) is still allowed and remains outlined on the timeline.`,
      };
    }

    if (full.length === coverage.length) {
      return {
        tone: 'full' as const,
        eyebrow: 'Selected meeting',
        title: 'Everyone is within working hours',
        detail: `All ${coverage.length} people cover the entire selected meeting (${formatDuration(s.durationMinutes)}).`,
      };
    }

    const partialDetail = partial
      .map(
        ({ participant, minutes }) =>
          `${participant.label}: ${formatDuration(minutes)} of ${formatDuration(s.durationMinutes)}`,
      )
      .join('; ');
    return {
      tone: covered.length > 0 ? ('partial' as const) : ('outside' as const),
      eyebrow:
        covered.length > 0
          ? 'Selected meeting · Partial coverage'
          : 'Selected meeting · Outside working hours',
      title: `${full.length} of ${coverage.length} cover the entire meeting`,
      detail:
        partialDetail ||
        `No one is within working hours during the selected ${formatDuration(s.durationMinutes)} meeting.`,
    };
  }, [meetingAt, s.durationMinutes, s.participants]);
  const shareLink = `${origin}/overlap?${s.query}`;
  const calendarEvent = useMemo<CalendarEvent | null>(() => {
    if (!meetingAt || !meetingEndsAt) return null;
    return {
      id: s.query,
      title: 'Team meeting',
      start: meetingAt,
      end: meetingEndsAt,
      timeZone: anchorZone,
      details: plainTextSummary(
        s.participants,
        meetingAt,
        meetingEndsAt,
        s.durationMinutes,
        hour12,
        shareLink,
      ),
    };
  }, [meetingAt, meetingEndsAt, anchorZone, s.participants, s.durationMinutes, hour12, shareLink]);

  /** The differentiator: which weeks will daylight saving move this meeting? */
  const shifts = useMemo(() => {
    if (!s.anchor || s.meetingMinutes === null) return [];
    return projectMeeting(s.participants, s.anchor.id, s.meetingMinutes, dayStart, 60).shifts.slice(
      0,
      5,
    );
  }, [s.anchor, s.participants, s.meetingMinutes, dayStart]);

  async function copy(kind: 'link' | 'text') {
    const value = kind === 'link' ? shareLink : (calendarEvent?.details ?? '');
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2400);
    } catch {
      if (kind === 'link') window.history.replaceState(null, '', value);
    }
  }

  function downloadIcs() {
    if (!calendarEvent) return;
    const blob = new Blob([buildIcs(calendarEvent)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hours-apart-${viewDate}-${String(s.meetingMinutes).padStart(4, '0')}.ics`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (!s.anchor) return null;

  return (
    <div className="space-y-7">
      {/* ------------------------------------------------------------- summary */}
      <section
        aria-live="polite"
        className={`planner-summary rounded-[1.5rem] border p-5 elev sm:p-6 ${
          selectedSummary?.tone === 'full'
            ? 'border-go-300 bg-go-100/55'
            : selectedSummary
              ? 'border-warn-400/45 bg-warn-100/50'
              : 'border-paper-200 bg-white'
        }`}
      >
        {selectedSummary ? (
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold tracking-[0.15em] text-paper-500 uppercase">
              {selectedSummary.eyebrow}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              {selectedSummary.title}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-paper-700">
              {selectedSummary.detail}
            </p>
          </div>
        ) : (
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold tracking-[0.15em] text-paper-500 uppercase">
              Choose a meeting time
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Select any start on the timeline
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-paper-700">
              The outline will show the full {formatDuration(s.durationMinutes)} meeting, and this
              summary will report each person&rsquo;s working-hours coverage.
            </p>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- grid */}
      <section aria-labelledby="grid-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.15em] text-paper-500 uppercase">
              Base clock &middot; {s.anchor.label}
            </p>
            <h2 id="grid-heading" className="mt-1 text-lg font-semibold">
              {formatIsoDateLong(viewDate)}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DateControl
              date={s.date}
              today={today}
              onChange={s.setDate}
              label={`Date in ${s.anchor.label}`}
            />
            <label className="flex h-9 items-center gap-2 rounded-lg border border-paper-200 bg-white px-2 text-xs font-medium text-paper-500">
              Start
              <select
                value={s.meetingMinutes ?? ''}
                onChange={(event) => s.setMeetingMinutes(Number(event.target.value))}
                aria-label="Meeting start"
                className="ring-focus nums bg-transparent font-semibold text-paper-900"
              >
                {s.meetingMinutes === null && <option value="">--:--</option>}
                {Array.from({ length: SLOTS }, (_, i) => i * SLOT_MINUTES).map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatMinutes(minutes, hour12)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-paper-200 bg-white px-2 text-xs font-medium text-paper-500">
              End
              <select
                value={s.durationMinutes}
                onChange={(event) => s.setDurationMinutes(Number(event.target.value))}
                aria-label="Meeting end"
                className="ring-focus nums bg-transparent font-semibold text-paper-900"
              >
                {Array.from(
                  { length: MAX_MEETING_MINUTES / MEETING_STEP_MINUTES },
                  (_, i) => (i + 1) * MEETING_STEP_MINUTES,
                ).map((minutes) => {
                  const startMinutes = s.meetingMinutes ?? 0;
                  const endMinutes = startMinutes + minutes;
                  const nextDay = endMinutes >= 1440 ? ` (+${Math.floor(endMinutes / 1440)}d)` : '';
                  return (
                    <option key={minutes} value={minutes}>
                      {formatMinutes(endMinutes % 1440, hour12)}
                      {nextDay} · {formatDuration(minutes)}
                    </option>
                  );
                })}
              </select>
            </label>
            <div
              role="group"
              aria-label="Time format"
              className="flex rounded-lg border border-paper-200 bg-white p-0.5"
            >
              {[false, true].map((use12) => (
                <button
                  key={String(use12)}
                  type="button"
                  aria-pressed={hour12 === use12}
                  onClick={() => setHour12(use12)}
                  className={`ring-focus rounded-md px-2 py-1.5 text-xs font-medium ${
                    hour12 === use12
                      ? 'bg-paper-900 text-paper-50'
                      : 'text-paper-500 hover:text-paper-900'
                  }`}
                >
                  {use12 ? '12h' : '24h'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-paper-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-go-100" aria-hidden="true" /> working hours
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-paper-100" aria-hidden="true" /> outside
            working hours
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm bg-paper-100 ring-1 ring-paper-900 ring-inset"
              aria-hidden="true"
            />{' '}
            selected meeting
          </span>
        </div>

        <div className="grid gap-2 md:hidden">
          {recommendedWindows.length > 0 ? (
            recommendedWindows.map((window) => {
              const everyone = window.availableIds.length === s.participants.length;
              const lastStart = window.endMinutes - s.durationMinutes;
              const selected =
                s.meetingMinutes !== null &&
                s.meetingMinutes >= window.startMinutes &&
                s.meetingMinutes <= lastStart;
              const startOptions = Array.from(
                { length: Math.floor((lastStart - window.startMinutes) / SLOT_MINUTES) + 1 },
                (_, index) => window.startMinutes + index * SLOT_MINUTES,
              );
              return (
                <div
                  key={`${window.startMinutes}-${window.endMinutes}`}
                  className={`flex items-center justify-between gap-4 rounded-xl border p-3.5 elev ${
                    selected
                      ? 'border-paper-900 bg-paper-100'
                      : everyone
                        ? 'border-go-300 bg-go-100/60'
                        : 'border-warn-400/40 bg-warn-100/45'
                  }`}
                >
                  <span>
                    <span className="nums block text-lg font-semibold">
                      {window.startMinutes === lastStart ? 'Start ' : 'Starts '}
                      {formatMinutes(window.startMinutes, hour12)}
                      {window.startMinutes !== lastStart && (
                        <>&ndash;{formatMinutes(lastStart, hour12)}</>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-paper-500">
                      {everyone
                        ? s.participants.length === 1
                          ? `The person can attend the entire meeting (${formatDuration(s.durationMinutes)}) within working hours`
                          : `All ${s.participants.length} people can attend the entire meeting (${formatDuration(s.durationMinutes)}) within working hours`
                        : `${window.availableIds.length} of ${s.participants.length} can attend the entire meeting (${formatDuration(s.durationMinutes)}) within working hours`}
                    </span>
                  </span>
                  <label className="shrink-0 text-[10px] font-semibold text-paper-500">
                    Start
                    <select
                      value={selected ? s.meetingMinutes! : window.startMinutes}
                      onChange={(event) => s.setMeetingMinutes(Number(event.target.value))}
                      aria-label={`Choose a ${formatDuration(s.durationMinutes)} start between ${formatMinutes(window.startMinutes, hour12)} and ${formatMinutes(lastStart, hour12)}`}
                      className="ring-focus nums mt-1 block h-9 rounded-lg border border-paper-200 bg-white px-2 text-xs font-semibold text-paper-900"
                    >
                      {startOptions.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {formatMinutes(minutes, hour12)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-paper-200 bg-white p-4 text-sm text-paper-500 elev">
              No candidate windows on this day. Try another date or adjust working days below.
            </div>
          )}
        </div>

        <div className="hidden overflow-x-auto rounded-2xl border border-paper-200 bg-white elev md:block">
          <div className="min-w-[80rem]">
            <div className="flex border-b border-paper-100 pl-40">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="nums flex-1 border-l border-paper-100 py-1.5 text-center text-[10px] text-paper-500"
                >
                  {h % 3 === 0 ? formatMinutes(h * 60, hour12).replace(':00', '') : ''}
                </div>
              ))}
            </div>

            {s.participants.map((p) => (
              <Row
                key={p.id}
                participant={p}
                columns={availabilityColumns}
                isAnchor={p.id === s.anchor.id}
                hour12={hour12}
                meetingAt={meetingAt}
                meetingEndsAt={meetingEndsAt}
                onPick={(minutes) => s.setMeetingMinutes(minutes)}
              />
            ))}
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-paper-500">
          Times follow <strong className="font-semibold">{s.anchor.label}</strong>&rsquo;s clock.
          <span className="hidden md:inline">
            {' '}
            Each row is shown in that person&rsquo;s own zone.
          </span>
        </p>
      </section>

      {/* -------------------------------------------------------------- people */}
      <section aria-labelledby="people-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="people-heading" className="text-lg font-semibold">
              People &amp; working hours
            </h2>
            <p className="mt-0.5 text-xs text-paper-500">
              Each person keeps their own local schedule.
            </p>
          </div>
          <span className="text-[11px] text-paper-500">Up to 12 people</span>
        </div>

        <ul className="grid gap-3 lg:grid-cols-2">
          {s.participants.map((p, index) => (
            <li key={p.id} className="rounded-2xl border border-paper-200 bg-white p-4 elev">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <input
                    value={p.label}
                    onChange={(e) => s.update(p.id, { label: e.target.value.slice(0, 40) })}
                    aria-label={`Name for ${p.label}`}
                    className="ring-focus w-full rounded-lg border border-transparent bg-paper-100 px-2.5 py-1.5 text-sm font-semibold hover:border-paper-200"
                  />
                  <span className="nums mt-1.5 block text-[11px] text-paper-500">
                    {p.timeZone.replace(/_/g, ' ')} &middot;{' '}
                    {formatOffset(offsetMinutes(dayStart, p.timeZone))}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => s.setAnchor(index)}
                    aria-pressed={p.id === s.anchor.id}
                    className={`ring-focus h-9 rounded-lg px-3 text-[10px] font-semibold ${
                      p.id === s.anchor.id
                        ? 'bg-paper-900 text-paper-50'
                        : 'border border-paper-200 text-paper-700 hover:border-paper-300'
                    }`}
                  >
                    {p.id === s.anchor.id ? 'Base clock' : 'Make base'}
                  </button>
                  <button
                    type="button"
                    onClick={() => s.remove(p.id)}
                    disabled={s.participants.length === 1}
                    aria-label={`Remove ${p.label}`}
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
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <label className="text-[10px] font-semibold tracking-wide text-paper-500 uppercase">
                  Starts
                  <TimeSelect
                    value={p.workStart}
                    hour12={hour12}
                    onChange={(v) => s.update(p.id, { workStart: v })}
                    label={`Work start for ${p.label}`}
                  />
                </label>
                <label className="text-[10px] font-semibold tracking-wide text-paper-500 uppercase">
                  Finishes
                  <TimeSelect
                    value={p.workEnd}
                    hour12={hour12}
                    onChange={(v) => s.update(p.id, { workEnd: v })}
                    label={`Work end for ${p.label}`}
                  />
                </label>
              </div>

              <fieldset className="mt-3">
                <legend className="text-[10px] font-semibold tracking-wide text-paper-500 uppercase">
                  Working days
                </legend>
                <div
                  className="mt-1.5 grid grid-cols-7 gap-1"
                  aria-label={`Work days for ${p.label}`}
                >
                  {DAY_LABELS.map((d, day) => {
                    const on = (p.workDays ?? DEFAULT_WORK_DAYS).includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${DAY_NAMES[day]} for ${p.label}`}
                        onClick={() => {
                          const days = new Set(p.workDays ?? DEFAULT_WORK_DAYS);
                          if (days.has(day)) days.delete(day);
                          else days.add(day);
                          s.update(p.id, { workDays: [...days].sort() });
                        }}
                        className={`ring-focus h-9 rounded-lg text-[10px] font-semibold transition-colors ${
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
              </fieldset>
            </li>
          ))}
        </ul>

        <div className="rounded-2xl border border-dashed border-paper-300 bg-paper-100/45 p-3">
          <CityPicker
            onAdd={(city) => s.add(city.timeZone, city.name)}
            placeholder="Add someone — city, airport code, or country"
          />
        </div>
      </section>

      {/* ------------------------------------------------- chosen time + DST */}
      {meetingAt && (
        <section aria-labelledby="meeting-heading" className="space-y-3">
          <h2 id="meeting-heading" className="text-sm font-semibold">
            {formatLocalRange(meetingAt, meetingEndsAt!, s.anchor.timeZone, hour12)} in{' '}
            {s.anchor.label} &middot; {formatDuration(s.durationMinutes)}
          </h2>

          <ul className="divide-y divide-paper-100 rounded-xl border border-paper-200 bg-white elev">
            {s.participants.map((p) => {
              const shift = calendarDayShift(meetingAt, p.timeZone, s.anchor.timeZone);
              const minutesWithinHours = meetingCoverageMinutes(p, meetingAt, s.durationMinutes);
              const fullCoverage = minutesWithinHours === s.durationMinutes;
              const partialCoverage = minutesWithinHours > 0 && !fullCoverage;
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="truncate">{p.label}</span>
                  <span className="nums flex flex-wrap items-center justify-end gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-sans text-[10px] ${
                        fullCoverage
                          ? 'bg-go-100 text-go-700'
                          : partialCoverage
                            ? 'bg-warn-100 text-warn-700'
                            : 'bg-paper-100 text-paper-500'
                      }`}
                    >
                      {fullCoverage
                        ? 'full meeting within hours'
                        : partialCoverage
                          ? `${formatDuration(minutesWithinHours)} of ${formatDuration(s.durationMinutes)} within hours`
                          : 'outside working hours'}
                    </span>
                    <span className="font-medium">
                      {formatLocalRange(meetingAt, meetingEndsAt!, p.timeZone, hour12)}
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
      <section aria-labelledby="share-heading" className="space-y-3">
        <div>
          <h2 id="share-heading" className="text-sm font-semibold">
            Share &amp; add to calendar
          </h2>
          <p className="mt-0.5 text-xs text-paper-500">
            The link keeps the cities, date, start time, and meeting length together. Opening Google
            or Outlook passes the prepared meeting details to that provider.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => copy('link')}
            className="ring-focus elev elev-hover rounded-xl bg-paper-900 px-4 py-2.5 text-sm font-semibold text-paper-50"
          >
            {copied === 'link' ? 'Link copied' : 'Copy shareable link'}
          </button>
          {calendarEvent && (
            <>
              <button
                type="button"
                onClick={downloadIcs}
                className="ring-focus rounded-lg border border-paper-200 bg-white px-4 py-2 text-sm font-medium text-paper-700 hover:border-paper-300"
              >
                Download .ics
              </button>
              <a
                href={googleCalendarUrl(calendarEvent)}
                target="_blank"
                rel="noreferrer"
                className="ring-focus rounded-lg border border-paper-200 bg-white px-4 py-2 text-sm font-medium text-paper-700 hover:border-paper-300"
              >
                Google Calendar
              </a>
              <a
                href={outlookCalendarUrl(calendarEvent)}
                target="_blank"
                rel="noreferrer"
                className="ring-focus rounded-lg border border-paper-200 bg-white px-4 py-2 text-sm font-medium text-paper-700 hover:border-paper-300"
              >
                Outlook
              </a>
              <button
                type="button"
                onClick={() => copy('text')}
                className="ring-focus rounded-lg px-3 py-2 text-sm text-paper-500 hover:text-paper-900"
              >
                {copied === 'text' ? 'Summary copied' : 'Copy meeting summary'}
              </button>
            </>
          )}
          <a
            href={`/?${s.query}`}
            className="ring-focus rounded-lg px-2 py-2 text-sm text-paper-500 hover:text-paper-900"
          >
            &larr; Back to the clock
          </a>
        </div>
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
  meetingEndsAt,
  onPick,
}: {
  participant: Participant;
  columns: MeetingCandidate[];
  isAnchor: boolean;
  hour12: boolean;
  meetingAt: Date | null;
  meetingEndsAt: Date | null;
  onPick: (minutes: number) => void;
}) {
  const offset = columns.length > 0 ? offsetMinutes(columns[0].at, participant.timeZone) : 0;

  /**
   * Outlining every quarter-hour cell separately turned a long meeting into a
   * solid black band that hid the green/grey fill underneath. Only the outer
   * edge of the run is drawn instead.
   */
  const inMeeting = (candidate: MeetingCandidate) =>
    meetingAt !== null &&
    meetingEndsAt !== null &&
    candidate.at.getTime() >= meetingAt.getTime() &&
    candidate.at.getTime() < meetingEndsAt.getTime();

  const selectedIndices = columns.reduce<number[]>((found, candidate, index) => {
    if (inMeeting(candidate)) found.push(index);
    return found;
  }, []);
  const selectedRange =
    selectedIndices.length > 0
      ? { from: selectedIndices[0], to: selectedIndices[selectedIndices.length - 1] }
      : null;

  return (
    <div
      className="flex border-b border-paper-100 last:border-b-0"
      data-working-hours-row={participant.id}
    >
      <div className="w-40 shrink-0 px-3 py-2">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-xs font-medium">{participant.label}</span>
          {isAnchor && <span className="text-[9px] text-paper-500">base</span>}
        </div>
        <span className="nums text-[10px] text-paper-500">{formatOffset(offset)}</span>
      </div>

      <div className="relative flex flex-1">
        {selectedRange && (
          <div
            aria-hidden="true"
            data-selection-overlay
            className="pointer-events-none absolute top-0 h-9 z-10 rounded-md border border-paper-900/45 bg-paper-900/[0.06] shadow-[0_1px_3px_oklch(0.235_0.014_75_/_0.12)]"
            style={{
              left: `${(selectedRange.from / columns.length) * 100}%`,
              width: `${((selectedRange.to - selectedRange.from + 1) / columns.length) * 100}%`,
            }}
          />
        )}
        {columns.map((col, index) => {
          const available = col.availableIds.includes(participant.id);
          const selected = inMeeting(col);
          const local = zonedParts(col.at, participant.timeZone);

          const localTime = formatMinutes(local.hour * 60 + local.minute, hour12);
          const workingState = available ? 'within working hours' : 'outside working hours';

          return (
            <button
              key={col.baseMinutes}
              type="button"
              disabled={!col.valid}
              onClick={() => onPick(col.baseMinutes)}
              data-working-hours={available ? 'inside' : 'outside'}
              data-selected-meeting={selected ? 'true' : 'false'}
              /*
               * Divider colour is inlined with a literal fallback. As a utility class
               * it resolves to `color-mix(... var(--color-paper-*) ...)`, and until
               * those custom properties are applied the browser falls back to
               * `currentColor` — a dark line that flashed on every first paint.
               */
              style={{
                borderLeftColor:
                  col.baseMinutes % 60 === 0
                    ? 'var(--color-paper-200, oklch(0.932 0.008 85))'
                    : 'var(--color-paper-100, oklch(0.972 0.006 85))',
              }}
              title={
                col.valid
                  ? `${participant.label} ${localTime} · ${workingState}`
                  : `${formatMinutes(col.baseMinutes, hour12)} does not occur when clocks change`
              }
              aria-label={
                col.valid
                  ? `Pick ${formatMinutes(col.baseMinutes, hour12)} — ${participant.label} ${localTime}, ${workingState}`
                  : `${formatMinutes(col.baseMinutes, hour12)} does not occur when clocks change`
              }
              className={[
                'ring-focus h-9 flex-1 border-l border-solid transition-[background-color] disabled:cursor-not-allowed disabled:bg-paper-200',
                available ? 'bg-go-100 hover:bg-go-300' : 'bg-paper-100/60 hover:bg-paper-200',
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
      className="ring-focus nums mt-1 block h-10 w-full rounded-lg border border-paper-200 bg-white px-2.5 text-sm font-medium text-paper-900"
    >
      {Array.from({ length: SLOTS }, (_, i) => i * SLOT_MINUTES).map((m) => (
        <option key={m} value={m}>
          {formatMinutes(m, hour12)}
        </option>
      ))}
    </select>
  );
}

function meetingCoverageMinutes(
  participant: Participant,
  meetingAt: Date,
  durationMinutes: number,
): number {
  let coveredMinutes = 0;
  for (let elapsed = 0; elapsed < durationMinutes; elapsed += 1) {
    const instant = new Date(meetingAt.getTime() + elapsed * 60_000);
    if (isAvailable(participant, instant)) coveredMinutes += 1;
  }
  return coveredMinutes;
}

function formatLocalRange(start: Date, end: Date, timeZone: string, hour12: boolean): string {
  const startParts = zonedParts(start, timeZone);
  const endParts = zonedParts(end, timeZone);
  const startMinutes = startParts.hour * 60 + startParts.minute;
  const endMinutes = endParts.hour * 60 + endParts.minute;
  const dayDelta = Math.round(
    (Date.UTC(endParts.year, endParts.month - 1, endParts.day) -
      Date.UTC(startParts.year, startParts.month - 1, startParts.day)) /
      86_400_000,
  );
  const dayNote = dayDelta === 0 ? '' : dayDelta > 0 ? ` (+${dayDelta} day)` : ` (${dayDelta} day)`;
  return `${formatMinutes(startMinutes, hour12)}–${formatMinutes(endMinutes, hour12)}${dayNote}`;
}

function calendarDayShift(instant: Date, timeZone: string, baseZone: string): number {
  const a = zonedParts(instant, timeZone);
  const b = zonedParts(instant, baseZone);
  return Math.round(
    (Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000,
  );
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
  meetingAt: Date,
  meetingEndsAt: Date,
  durationMinutes: number,
  hour12: boolean,
  shareLink: string,
): string {
  const lines = participants.map((participant) => {
    const minutesWithinHours = meetingCoverageMinutes(participant, meetingAt, durationMinutes);
    const coverage =
      minutesWithinHours === durationMinutes
        ? 'full meeting within working hours'
        : minutesWithinHours > 0
          ? `${formatDuration(minutesWithinHours)} of ${formatDuration(durationMinutes)} within working hours`
          : 'outside working hours';
    return `${participant.label}: ${formatLocalRange(meetingAt, meetingEndsAt, participant.timeZone, hour12)} (${participant.timeZone}) · ${coverage}`;
  });
  return [
    ...lines,
    '',
    `Duration: ${formatDuration(durationMinutes)}`,
    `UTC: ${meetingAt.toISOString()} – ${meetingEndsAt.toISOString()}`,
    `Hours Apart: ${shareLink}`,
  ].join('\n');
}
