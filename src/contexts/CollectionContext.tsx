import { createContext, useContext, type ReactNode } from 'react';

/**
 * CollectionContext — host-supplied metadata about the collection vellum
 * is reading. Currently a single field (`eyebrow`), used by IndexView to
 * label the cartouche above its "Index" title with the collection or
 * city name. Hosts that don't supply a value get an empty context, and
 * IndexView omits the eyebrow.
 *
 * Kept deliberately small: this is not a place for adapter capabilities
 * (those belong on the Adapter interface) or rendering policy (theme
 * tokens). Just naming.
 */
interface CollectionContextValue {
  eyebrow?: string;
}

const CollectionContext = createContext<CollectionContextValue>({});

export function CollectionProvider({
  eyebrow,
  children,
}: {
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <CollectionContext.Provider value={{ eyebrow }}>
      {children}
    </CollectionContext.Provider>
  );
}

export function useCollection(): CollectionContextValue {
  return useContext(CollectionContext);
}
