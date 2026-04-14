/**
 * FileViewerPage — top-level vellum page for displaying a single project file.
 *
 * Fetches a `FileContent` through the active adapter and delegates rendering
 * to `FileReader`. Handles loading and empty states; lets the host frame the
 * page (title bar, close button, keyboard shortcuts, routing). Hosts pass the
 * path and an optional originId; vellum has no opinion about where a file
 * lives on disk.
 *
 * This is the React surface that will eventually replace portolan's
 * FileViewerModal. During the absorption it can be mounted inside the
 * existing modal shell so hotkeys and positioning stay with portolan until
 * the dust settles.
 */

import { useEffect, useState } from 'react';
import { useAdapter } from '../contexts/AdapterContext';
import type { FileContent } from '../utils/content-types';
import { FileReader } from '../components/FileReader';

export interface FileViewerPageProps {
  path: string;
  originId?: string;
  cacheBust?: boolean;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; file: FileContent };

export function FileViewerPage({ path, originId, cacheBust }: FileViewerPageProps) {
  const adapter = useAdapter();
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    adapter
      .getFile(path, { originId, cacheBust })
      .then((file) => {
        if (cancelled) return;
        if (!file) {
          setState({ status: 'empty' });
          return;
        }
        setState({ status: 'ready', file });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, path, originId, cacheBust]);

  if (state.status === 'loading') {
    return <div className="vellum-file-viewer-page vellum-file-viewer-page--loading">Loading {path}…</div>;
  }
  if (state.status === 'empty') {
    return (
      <div className="vellum-file-viewer-page vellum-file-viewer-page--empty">
        Could not load <code>{path}</code>.
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="vellum-file-viewer-page vellum-file-viewer-page--error">
        Error loading <code>{path}</code>: {state.message}
      </div>
    );
  }
  return (
    <div className="vellum-file-viewer-page">
      <FileReader file={state.file} />
    </div>
  );
}
