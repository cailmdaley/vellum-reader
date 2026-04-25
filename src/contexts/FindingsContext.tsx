/**
 * FindingsContext — supplies the active fiber's findings list plus the
 * host GraphNode to any component rendered inside the narrative subtree.
 * The host node is needed for figure-evidence thumbnails (`/static/<slug>/
 * <artifact>`) — same shape Card.tsx resolves.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { GraphFinding, GraphNode } from '~/utils/content-types';

interface FindingsContextValue {
  findings: GraphFinding[];
  hostNode?: GraphNode;
}

const FindingsContext = createContext<FindingsContextValue>({ findings: [] });

export function FindingsProvider({
  findings,
  hostNode,
  children,
}: {
  findings: GraphFinding[];
  hostNode?: GraphNode;
  children: ReactNode;
}) {
  return (
    <FindingsContext.Provider value={{ findings, hostNode }}>
      {children}
    </FindingsContext.Provider>
  );
}

export function useFindingsContext(): FindingsContextValue {
  return useContext(FindingsContext);
}

/** Back-compat shortcut: findings list only. */
export function useFindings(): GraphFinding[] {
  return useContext(FindingsContext).findings;
}
