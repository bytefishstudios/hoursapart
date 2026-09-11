import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_WORK_DAYS,
  DEFAULT_WORK_END,
  DEFAULT_WORK_START,
  type Participant,
} from './overlap';
import {
  DEFAULT_MEETING_DURATION,
  decodeScenario,
  encodeScenario,
  type MeetingDuration,
} from './share';
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

interface ScenarioCore {
  participants: Participant[];
  /** Identity, not array position: reordering must never silently change the base. */
  anchorId: string;
}

/**
 * Reorder one visible city while leaving the hidden base in its original slot.
 * Reorder targets use visible-list indexes, so the base must never consume one.
 */
export function reorderParticipant(
  participants: Participant[],
  id: string,
  targetVisibleIndex: number,
  anchorId: string,
): Participant[] {
  if (id === anchorId) return participants;

  const visible = participants.filter((participant) => participant.id !== anchorId);
  const currentVisibleIndex = visible.findIndex((participant) => participant.id === id);
  if (currentVisibleIndex < 0 || visible.length < 2) return participants;

  const target = Math.max(0, Math.min(visible.length - 1, targetVisibleIndex));
  if (target === currentVisibleIndex) return participants;

  const reordered = [...visible];
  const [moved] = reordered.splice(currentVisibleIndex, 1);
  reordered.splice(target, 0, moved);

  let visibleIndex = 0;
  return participants.map((participant) =>
    participant.id === anchorId ? participant : reordered[visibleIndex++],
  );
}

/** Remove one entry while preserving the base, or choosing an adjacent replacement. */
export function removeParticipant(
  participants: Participant[],
  id: string,
  anchorId: string,
): ScenarioCore {
  if (participants.length <= 1) return { participants, anchorId };
  const index = participants.findIndex((participant) => participant.id === id);
  if (index < 0) return { participants, anchorId };

  const next = participants.filter((participant) => participant.id !== id);
  return {
    participants: next,
    anchorId: id === anchorId ? next[Math.min(index, next.length - 1)].id : anchorId,
  };
}

export interface ScenarioState {
  participants: Participant[];
  anchorIndex: number;
  anchor: Participant;
  meetingMinutes: number | null;
  durationMinutes: MeetingDuration;
  /** Calendar day in the anchor's zone, or `null` for "today, live". */
  date: string | null;
  /** Current scenario as a query string, for cross-view links and sharing. */
  query: string;
  hydrated: boolean;

  add: (timeZone: string, label?: string) => void;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<Participant>) => void;
  reorder: (id: string, targetVisibleIndex: number) => void;
  setAnchor: (index: number) => void;
  setMeetingMinutes: (minutes: number | null) => void;
  setDurationMinutes: (minutes: MeetingDuration) => void;
  setDate: (date: string | null) => void;
}

export function useScenario(): ScenarioState {
  const [core, setCore] = useState<ScenarioCore>(() => {
    const participants = seed();
    return { participants, anchorId: participants[0].id };
  });
  const [meetingMinutes, setMeetingMinutes] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<MeetingDuration>(DEFAULT_MEETING_DURATION);
  const [date, setDate] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const { participants, anchorId } = core;

  // Read the URL once on mount. Server-rendered markup uses the seed, so this
  // is also where a shared link takes over.
  useEffect(() => {
    const shared = decodeScenario(window.location.search);
    if (shared) {
      setCore({
        participants: shared.participants,
        anchorId: shared.participants[shared.anchorIndex].id,
      });
      setMeetingMinutes(shared.meetingMinutes);
      setDurationMinutes(shared.durationMinutes);
      setDate(shared.date);
    }
    setHydrated(true);
  }, []);

  const matchedAnchorIndex = participants.findIndex((participant) => participant.id === anchorId);
  const anchorIndex = matchedAnchorIndex >= 0 ? matchedAnchorIndex : 0;
  const anchor = participants[anchorIndex];
  const query = useMemo(
    () =>
      encodeScenario({
        participants,
        anchorIndex,
        meetingMinutes,
        durationMinutes,
        date,
      }),
    [participants, anchorIndex, meetingMinutes, durationMinutes, date],
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
    setCore((previous) => ({
      ...previous,
      participants:
        previous.participants.length >= 12
          ? previous.participants
          : [...previous.participants, makeParticipant(timeZone, label)],
    }));
  }, []);

  const remove = useCallback((id: string) => {
    setCore((previous) => removeParticipant(previous.participants, id, previous.anchorId));
  }, []);

  const update = useCallback((id: string, patch: Partial<Participant>) => {
    setCore((previous) => ({
      ...previous,
      participants: previous.participants.map((participant) =>
        participant.id === id ? { ...participant, ...patch } : participant,
      ),
    }));
  }, []);

  const reorder = useCallback((id: string, targetVisibleIndex: number) => {
    setCore((previous) => ({
      ...previous,
      participants: reorderParticipant(
        previous.participants,
        id,
        targetVisibleIndex,
        previous.anchorId,
      ),
    }));
  }, []);

  const setAnchor = useCallback((index: number) => {
    setCore((previous) => {
      const selected = previous.participants[index];
      return selected ? { ...previous, anchorId: selected.id } : previous;
    });
  }, []);

  return {
    participants,
    anchorIndex,
    anchor,
    meetingMinutes,
    durationMinutes,
    date,
    query,
    hydrated,
    add,
    remove,
    update,
    reorder,
    setAnchor,
    setMeetingMinutes,
    setDurationMinutes,
    setDate,
  };
}
