import { createContext, useContext, useState, type ReactNode } from 'react';

export type Mode = 'narrative' | 'workspace' | 'map' | 'delta';

interface ModeContextValue {
  mode: Mode;
  setMode: (mode: Mode) => void;
}

const ModeContext = createContext<ModeContextValue>({
  mode: 'narrative',
  setMode: () => {},
});

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('narrative');
  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  return useContext(ModeContext);
}
