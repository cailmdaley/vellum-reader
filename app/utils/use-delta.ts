/**
 * useDelta — client-side hook for the delta view.
 *
 * Tracks the user's last visit in localStorage, fetches log events
 * since that timestamp, and provides the set of changed fiber IDs
 * for visual treatment in margins and workspace.
 */

import { useEffect, useState, useCallback } from 'react';
import type { LogEvent } from './content-server';

const STORAGE_KEY = 'vellum:lastVisit';

interface DeltaState {
  events: LogEvent[];
  changedIds: Set<string>;
  since: string | null;
  loading: boolean;
  dismissed: boolean;
}

export function useDelta() {
  const [state, setState] = useState<DeltaState>({
    events: [],
    changedIds: new Set(),
    since: null,
    loading: true,
    dismissed: false,
  });

  useEffect(() => {
    const lastVisit = localStorage.getItem(STORAGE_KEY);
    if (!lastVisit) {
      // First visit — record timestamp, no delta to show
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    // Fetch changes since last visit
    fetch(`/api/delta?since=${encodeURIComponent(lastVisit)}`)
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((data: { events?: LogEvent[] }) => {
        const events = data.events ?? [];
        // Deduplicate: collect unique fiber IDs that changed
        const changedIds = new Set(events.map((e) => e.fiberId));
        setState({
          events,
          changedIds,
          since: lastVisit,
          loading: false,
          dismissed: false,
        });
      })
      .catch(() => {
        setState((s) => ({ ...s, loading: false }));
      });
  }, []);

  const acknowledge = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    setState((s) => ({ ...s, dismissed: true, changedIds: new Set(), events: [] }));
  }, []);

  return {
    deltaEvents: state.events,
    changedIds: state.changedIds,
    since: state.since,
    loading: state.loading,
    dismissed: state.dismissed,
    acknowledge,
  };
}
