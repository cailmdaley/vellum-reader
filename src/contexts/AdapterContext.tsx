import { createContext, useContext, type ReactNode } from 'react';
import type { Adapter, ReadOnlyAdapter } from '../adapter';

const AdapterContext = createContext<Adapter | null>(null);

export function AdapterProvider({
  adapter,
  children,
}: {
  adapter: Adapter;
  children: ReactNode;
}) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

export function useAdapter(): Adapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) {
    throw new Error('useAdapter must be used inside an <AdapterProvider>');
  }
  return adapter;
}

export function useReadOnlyAdapter(): ReadOnlyAdapter {
  return useAdapter();
}
