import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_WORK_DAYS,
  DEFAULT_WORK_END,
  DEFAULT_WORK_START,
  type Participant,
} from './overlap';
import { decodeScenario, encodeScenario } from './share';
import { labelForTimeZone } from './cities';
import { localTimeZone } from './zone';

/**
 * One city list, shared by every view, living in the URL.
 *
 * The most irritating thing about existing planners is entering six cities on
 * the clock page and then entering them again on the meeting page. Holding the
 * scenario in the query string fixes that and gives us the shareable link for
 * free: there is no server, so the URL is the only place state can live.
 */

let counter = 0;
export function makeParticipant(timeZone: string, label?: string): Participant {
  counter += 1;
  return {
    id: `p${counter}`,
    label: label ?? labelForTimeZone(timeZone),
    timeZone,
    workStart: DEFAULT_WORK_START,
    workEnd: DEFAULT_WORK_END,
    workDays: [...DEFAULT_WORK_DAYS],
  };
}

/**
 * The viewer plus the three cities a world clock is most often asked about.
 *
 * An empty state would make a first-time visitor do setup before seeing
 * anything work, and a two-city default risks seeding a pair with no overlap at
 * all, which reads as a broken tool rather than an honest answer.
 */
function seed(): Participant[] {
  const mine = localTimeZone();
  const wanted = ['Europe/London', 'America/New_York', 'Asia/Tokyo'];
  const zones = [mine, ...wanted.filter((z) => z !== mine)].slice(0, 4);
  return zones.map((z) => makeParticipant(z));
}

export interface ScenarioState {
  participants: Participant[];
  anchorIndex: number;
  anchor: Participant;
  meetingMinutes: number | null;
  /** Calendar day in the anchor's zone, or `null` for "today, live". */
  date: string | null;
  /** Current scenario as a query string, for cross-view links and sharing. */
  query: string;
  hydrated: boolean;

  add: (timeZone: string, label?: string) => void;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<Participant>) => void;
  move: (id: string, direction: -1 | 1) => void;
  setAnchor: (index: number) => void;
  setMeetingMinutes: (minutes: number | null) => void;
  setDate: (date: string | null) => void;
}

export function useScenario(): ScenarioState {
  const [participants, setParticipants] = useState<Participant[]>(seed);
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [meetingMinutes, setMeetingMinutes] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Read the URL once on mount. Server-rendered markup uses the seed, so this
  // is also where a shared link takes over.
  useEffect(() => {
    const shared = decodeScenario(window.location.search);
    if (shared) {
      setParticipants(shared.participants);
      setAnchorIndex(shared.anchorIndex);
      setMeetingMinutes(shared.meetingMinutes);
      setDate(shared.date);
    }
    setHydrated(true);
  }, []);

  const safeAnchorIndex = Math.min(anchorIndex, Math.max(0, participants.length - 1));
  const query = useMemo(
    () => encodeScenario({ participants, anchorIndex: safeAnchorIndex, meetingMinutes, date }),
    [participants, safeAnchorIndex, meetingMinutes, date],
  );

  // Mirror state into the address bar so a reload, a bookmark or a copied URL
  // all reproduce the same view. replaceState keeps the back button usable.
  useEffect(() => {
    if (!hydrated) return;
    const next = `${window.location.pathname}?${query}`;
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [query, hydrated]);

  const add = useCallback((timeZone: string, label?: string) => {
    setParticipants((prev) =>
      prev.length >= 12 ? prev : [...prev, makeParticipant(timeZone, label)],
    );
  }, []);

  const remove = useCallback((id: string) => {
    setParticipants((prev) => (prev.length === 1 ? prev : prev.filter((p) => p.id !== id)));
  }, []);

  const update = useCallback((id: string, patch: Partial<Participant>) => {
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const move = useCallback((id: string, direction: -1 | 1) => {
    setParticipants((prev) => {
      const index = prev.findIndex((p) => p.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  return {
    participants,
    anchorIndex: safeAnchorIndex,
    anchor: participants[safeAnchorIndex] ?? participants[0],
    meetingMinutes,
    date,
    query,
    hydrated,
    add,
    remove,
    update,
    move,
    setAnchor: setAnchorIndex,
    setMeetingMinutes,
    setDate,
  };
}
