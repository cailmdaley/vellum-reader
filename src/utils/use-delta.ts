import { useCallback, useEffect, useState } from 'react';
import { getDeltaSince } from '~/api';
import type { LogEvent } from './content-types';

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
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      return;
    }

    getDeltaSince(lastVisit).then(({ events }) => {
      setState({
        events,
        changedIds: new Set(events.map((event) => event.fiberId)),
        since: lastVisit,
      });
    });
  }, []);

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
