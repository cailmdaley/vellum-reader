/**
 * FileTargetContext — host-supplied file target for the workspace.
 *
 * When the host opens `WorkspaceMount` with `initialFilePath` (instead of
 * `initialSlug`), the workspace lands in *file mode*: FiberPage routes the
 * narrative slot to FileViewerPage, FloatingIsland disables the modes that
 * are fiber-collection concepts (Workspace, Delta), and the keyboard handler
 * stops responding to `2` / `3`.
 *
 * The path / originId / editable / jumpToLine props don't fit the slug-based
 * URL routing that drives fiber navigation, so they ride this context for the
 * lifetime of the mount. The file target is sticky to the initial mount —
 * once the user clicks a wikilink and navigates to a fiber slug, the workspace
 * reverts to fiber mode and the file target is no longer consulted (the URL
 * is no longer `/__file`).
 *
 * `headerAnnotationActions` are file-specific (path-bound), so they ride here
 * rather than through the global AnnotationActionsContext (which is for
 * fiber-page bulk actions).
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { AnnotationAction, AnnotationBulkAction } from '../utils/content-types';

/** Special pathname FiberPage looks for to switch into file mode. The actual
 *  file path can't fit cleanly in a memory-router URL (forward slashes,
 *  spaces), so the route is just a marker; the path lives in the context. */
export const FILE_TARGET_ROUTE = '/__file';

export interface FileTarget {
  path: string;
  originId?: string;
  editable?: boolean;
  jumpToLine?: number;
  /** Per-annotation actions forwarded to FileViewerPage. */
  annotationActions?: AnnotationAction[];
  /** Bulk actions rendered in the file-mode toolbar when ≥1 annotation is
   *  present. Same shape FileViewerModal accepts. */
  headerAnnotationActions?: AnnotationBulkAction[];
}

const FileTargetContext = createContext<FileTarget | null>(null);

export function FileTargetProvider({
  target,
  children,
}: {
  target: FileTarget | null;
  children: ReactNode;
}) {
  return (
    <FileTargetContext.Provider value={target}>
      {children}
    </FileTargetContext.Provider>
  );
}

export function useFileTarget(): FileTarget | null {
  return useContext(FileTargetContext);
}
