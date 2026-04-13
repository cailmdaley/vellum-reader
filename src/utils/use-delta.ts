import { useCallback, useEffect, useState } from 'react';
import { getDeltaSince } from '~/api';
import type { LogEvent } from './content-types';

const STORAGE_KEY = 'vellum:lastVisit';
const INBOX_LIMIT = 50;

interface DeltaState {
  events: LogEvent[];
  changedIds: Set<string>;
  since: string | null;
}

const EMPTY_STATE: DeltaState = {
  events: [],
  changedIds: new Set(),
  since: null,
};

/**
 * Delta state has two audiences. `changedIds` drives the ambient highlight
 * on Narrative/Workspace/Map — it's gated on last-visit timestamp so the
 * highlights clear when the user acknowledges. `events` drives the delta
 * inbox — a rolling window of the last N events across all fibers,
 * ungated, so the inbox is never empty once the project has a history.
 *
 * The inbox additionally filters out any fiber the user has just Tempered
 * or Archived in this session, so acting on one card from fiber X clears
 * every other card from X (per the delta-inbox fiber). Dismissal is
 * session-local; a reload re-fetches and shows whatever is newest.
 */
export function useDelta() {
  const [state, setState] = useState<DeltaState>(EMPTY_STATE);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const fetchEvents = useCallback(() => {
    const lastVisit = localStorage.getItem(STORAGE_KEY);
    if (!lastVisit) {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    }
    const since = lastVisit ?? new Date(0).toISOString();
    getDeltaSince(since).then(({ events }) => {
      // The server already sorts newest-first; cap at INBOX_LIMIT for the
      // rolling window regardless of how much history it returned.
      const inbox = events.slice(0, INBOX_LIMIT);
      const changed = lastVisit
        ? new Set(
            events
              .filter((e) => Date.parse(e.at) >= Date.parse(lastVisit))
              .map((e) => e.fiberId),
          )
        : new Set<string>();
      setState({ events: inbox, changedIds: changed, since: lastVisit });
    });
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const acknowledge = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    setState((prev) => ({ ...prev, changedIds: new Set() }));
  }, []);

  const dismissFiber = useCallback((fiberId: string) => {
    setDismissed((prev) => {
      if (prev.has(fiberId)) return prev;
      const next = new Set(prev);
      next.add(fiberId);
      return next;
    });
  }, []);

  const visibleEvents = state.events.filter((event) => !dismissed.has(event.fiberId));

  return {
    deltaEvents: visibleEvents,
    changedIds: state.changedIds,
    since: state.since,
    acknowledge,
    dismissFiber,
    refresh: fetchEvents,
  };
}
