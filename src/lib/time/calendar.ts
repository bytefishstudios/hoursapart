export interface CalendarEvent {
  /** Stable scenario identity used to prevent unrelated imports colliding. */
  id: string;
  title: string;
  start: Date;
  /** Exclusive end instant. */
  end: Date;
  /** IANA zone used as the calendar UI's display context. */
  timeZone: string;
  details: string;
}

/** RFC 5545 UTC date-time, e.g. 20260901T063000Z. */
export function formatCalendarUtc(instant: Date): string {
  return instant
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Escape text values for an RFC 5545 content line. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** Fold a content line at 75 UTF-8 octets, as recommended by RFC 5545. */
function foldIcsLine(line: string): string[] {
  const encoder = new TextEncoder();
  const folded: string[] = [];
  let current = '';
  let limit = 75;

  for (const character of line) {
    if (current && encoder.encode(current + character).length > limit) {
      folded.push(folded.length === 0 ? current : ` ${current}`);
      current = character;
      limit = 74;
    } else {
      current += character;
    }
  }
  folded.push(folded.length === 0 ? current : ` ${current}`);
  return folded;
}

/** Small deterministic hash suitable for an opaque calendar UID component. */
function stableId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Portable calendar file using absolute UTC endpoints and CRLF line endings. */
export function buildIcs(event: CalendarEvent, createdAt = new Date()): string {
  const start = formatCalendarUtc(event.start);
  const end = formatCalendarUtc(event.end);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hours Apart//Meeting Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:hoursapart-${stableId(event.id)}-${start}-${end}@hoursapart.app`,
    `DTSTAMP:${formatCalendarUtc(createdAt)}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.details)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.flatMap(foldIcsLine).join('\r\n')}\r\n`;
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatCalendarUtc(event.start)}/${formatCalendarUtc(event.end)}`,
    details: event.details,
    ctz: event.timeZone,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function outlookCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: event.start.toISOString(),
    enddt: event.end.toISOString(),
    body: event.details,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}
