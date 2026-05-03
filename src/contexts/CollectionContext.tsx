import { createContext, useContext, type ReactNode } from 'react';

/**
 * CollectionContext — host-supplied metadata about the collection vellum
 * is reading. Two fields today:
 *
 *   - `eyebrow` — used by IndexView to label the cartouche above its
 *     "Index" title with the collection or city name. Omitted when the
 *     host doesn't supply a value.
 *   - `onIndexEscalate` — invoked when the user clicks the thumb-index
 *     `← index` button while sitting at the *top* of this collection's
 *     local graph (a root fiber with no parent). Lets an embedding host
 *     (e.g. portolan) treat the click as "escape upward to the next
 *     scope" — typically remounting vellum on a higher-level synthetic
 *     collection. When omitted, the button falls back to the local
 *     `navigate('')` behaviour: land on `<IndexView>` for the current
 *     graph (or, if a `rootSlug` is set, bounce back to it via
 *     FiberPage's redirect effect — i.e. effectively a no-op).
 *
 * Kept deliberately small: this is not a place for adapter capabilities
 * (those belong on the Adapter interface) or rendering policy (theme
 * tokens). Naming + collection-scope navigation only.
 */
interface CollectionContextValue {
  eyebrow?: string;
  onIndexEscalate?: () => void;
}

const CollectionContext = createContext<CollectionContextValue>({});

export function CollectionProvider({
  eyebrow,
  onIndexEscalate,
  children,
}: {
  eyebrow?: string;
  onIndexEscalate?: () => void;
  children: ReactNode;
}) {
  return (
    <CollectionContext.Provider value={{ eyebrow, onIndexEscalate }}>
      {children}
    </CollectionContext.Provider>
  );
}

export function useCollection(): CollectionContextValue {
  return useContext(CollectionContext);
}
