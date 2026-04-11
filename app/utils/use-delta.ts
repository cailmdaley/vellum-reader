/**
 * useDelta — client-side hook for the delta view.
 *
 * Tracks the user's last visit in localStorage, fetches log events
 * since that timestamp, and provides the set of changed fiber IDs
 * for visual treatment in margins and workspace.
 */

import { useEffect, useState, useCallback } from 'react';
import type { LogEvent } from './content-types';
import { getDeltaSince } from './api-client';

const STORAGE_KEY = 'vellum:lastVisit';

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

export function useDelta() {
  const [state, setState] = useState<DeltaState>(EMPTY_STATE);

  useEffect(() => {
    const lastVisit = localStorage.getItem(STORAGE_KEY);
    if (!lastVisit) {
      // First visit — record timestamp, no delta to show
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      return;
    }

    // Fetch changes since last visit
    getDeltaSince(lastVisit).then(({ events }) => {
      setState({
        events,
        changedIds: new Set(events.map((e) => e.fiberId)),
        since: lastVisit,
      });
    });
  }, []);

  // Acknowledge clears the delta state. Because both `events` and
  // `changedIds` become empty, downstream consumers naturally render
  // zero counts and an empty list — no separate "dismissed" flag.
  const acknowledge = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    setState(EMPTY_STATE);
  }, []);

  return {
    deltaEvents: state.events,
    changedIds: state.changedIds,
    since: state.since,
    acknowledge,
  };
}
