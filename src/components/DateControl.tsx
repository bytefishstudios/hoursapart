import { addDays, formatIsoDateLong, isValidIsoDate } from '../lib/time/zone';

/**
 * Date picker shared by the clock and the planner.
 *
 * A native `input[type=date]` on purpose. It gets the platform's own calendar
 * on mobile, keyboard entry on desktop, and screen reader support for free —
 * none of which a hand-rolled calendar popover would match without a lot of
 * work that adds nothing a visitor would notice.
 *
 * `null` is a real value here, distinct from today's date: it means "stay live".
 * A pinned date freezes the view, which is what you want for a link about a
 * specific day and not what you want for a bookmarked clock.
 */
export default function DateControl({
  date,
  today,
  onChange,
  label = 'Date',
}: {
  date: string | null;
  /** Today in the relevant zone, used when nothing is pinned. */
  today: string;
  onChange: (date: string | null) => void;
  label?: string;
}) {
  const value = date ?? today;
  const live = date === null;

  return (
    <div className="date-control flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(addDays(value, -1))}
        aria-label="Previous day"
        className="ring-focus flex h-9 w-9 items-center justify-center rounded-lg border border-paper-200 bg-white text-sm text-paper-500 hover:border-paper-300 hover:text-paper-900"
      >
        &larr;
      </button>

      <label className="relative">
        <span className="sr-only">{label}</span>
        <input
          type="date"
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            // Clearing the field, or a half-typed year, should not blank the view.
            if (isValidIsoDate(next)) onChange(next === today ? null : next);
          }}
          className="ring-focus nums h-9 min-w-[8.5rem] rounded-lg border border-paper-200 bg-white px-2.5 text-xs"
        />
      </label>

      <button
        type="button"
        onClick={() => onChange(addDays(value, 1))}
        aria-label="Next day"
        className="ring-focus flex h-9 w-9 items-center justify-center rounded-lg border border-paper-200 bg-white text-sm text-paper-500 hover:border-paper-300 hover:text-paper-900"
      >
        &rarr;
      </button>

      {!live && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ring-focus h-9 rounded-lg bg-paper-900 px-3 text-xs font-semibold text-paper-50"
        >
          Today
        </button>
      )}

      <span className="inline-flex items-center gap-1.5 px-1 text-xs text-paper-500">
        {live && <span className="h-1.5 w-1.5 rounded-full bg-go-500" aria-hidden="true" />}
        {live ? 'Live' : formatIsoDateLong(value).replace(/,/g, '')}
      </span>
    </div>
  );
}
