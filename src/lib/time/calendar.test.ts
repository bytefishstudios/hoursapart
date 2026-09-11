import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  escapeIcsText,
  formatCalendarUtc,
  googleCalendarUrl,
  outlookCalendarUrl,
  type CalendarEvent,
} from './calendar';

const event: CalendarEvent = {
  id: 'p=sydney_london&m=990&l=90',
  title: 'Planning, review',
  start: new Date('2026-09-01T06:30:00.000Z'),
  end: new Date('2026-09-01T08:00:00.000Z'),
  timeZone: 'Australia/Sydney',
  details: 'Sydney: 16:30–18:00\nLondon: 07:30–09:00\nhttps://hoursapart.app/overlap?p=x',
};

describe('calendar exports', () => {
  it('formats absolute UTC endpoints for calendar providers', () => {
    expect(formatCalendarUtc(event.start)).toBe('20260901T063000Z');
    expect(formatCalendarUtc(event.end)).toBe('20260901T080000Z');
  });

  it('escapes ICS text delimiters, newlines, and backslashes', () => {
    expect(escapeIcsText('one, two; C:\\temp\nnext')).toBe('one\\, two\\; C:\\\\temp\\nnext');
  });

  it('builds a CRLF calendar file with an exclusive UTC end', () => {
    const ics = buildIcs(event, new Date('2026-08-31T12:00:00.000Z'));
    expect(ics).toContain('DTSTART:20260901T063000Z\r\n');
    expect(ics).toContain('DTEND:20260901T080000Z\r\n');
    expect(ics).toContain('DTSTAMP:20260831T120000Z\r\n');
    expect(ics).toContain('SUMMARY:Planning\\, review\r\n');
    expect(ics).toMatch(/DESCRIPTION:.*\\n.*\\n/);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('gives same-time meetings stable but scenario-specific identities', () => {
    const first = buildIcs(event, new Date('2026-08-31T12:00:00.000Z'));
    const repeat = buildIcs(event, new Date('2026-09-01T12:00:00.000Z'));
    const other = buildIcs(
      { ...event, id: 'p=tokyo_london&m=990&l=90' },
      new Date('2026-08-31T12:00:00.000Z'),
    );
    const uid = (ics: string) => ics.match(/UID:([^\r]+)/)?.[1];
    expect(uid(first)).toBe(uid(repeat));
    expect(uid(first)).not.toBe(uid(other));
  });

  it('creates an encoded Google Calendar template URL', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin).toBe('https://calendar.google.com');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe(event.title);
    expect(url.searchParams.get('dates')).toBe('20260901T063000Z/20260901T080000Z');
    expect(url.searchParams.get('details')).toBe(event.details);
    expect(url.searchParams.get('ctz')).toBe('Australia/Sydney');
  });

  it('creates an encoded Outlook compose URL with ISO instants', () => {
    const url = new URL(outlookCalendarUrl(event));
    expect(url.origin).toBe('https://outlook.live.com');
    expect(url.searchParams.get('path')).toBe('/calendar/action/compose');
    expect(url.searchParams.get('rru')).toBe('addevent');
    expect(url.searchParams.get('subject')).toBe(event.title);
    expect(url.searchParams.get('startdt')).toBe(event.start.toISOString());
    expect(url.searchParams.get('enddt')).toBe(event.end.toISOString());
    expect(url.searchParams.get('body')).toBe(event.details);
  });
});
