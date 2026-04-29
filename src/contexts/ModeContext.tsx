import { createContext, useContext, useState, type ReactNode } from 'react';

export type Mode = 'narrative' | 'workspace' | 'delta';

interface ModeContextValue {
  mode: Mode;
  setMode: (mode: Mode) => void;
}

const ModeContext = createContext<ModeContextValue>({
  mode: 'narrative',
  setMode: () => {},
});

export function ModeProvider({
  children,
  initialMode = 'narrative',
}: {
  children: ReactNode;
  /** Mode to land on at first render. Defaults to 'narrative' (vellum's
   *  standalone behaviour). Embedding hosts that want to deep-link into
   *  Workspace or Delta pass this. After first render, `setMode` controls
   *  the active mode like normal. */
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  return useContext(ModeContext);
}
