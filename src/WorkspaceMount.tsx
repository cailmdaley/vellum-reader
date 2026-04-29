// WorkspaceMount — embeddable FiberPage shell for external hosts.
//
// Mirrors App.tsx's provider stack but carries its own MemoryRouter + ModeProvider
// so the host doesn't need to know about routing. AdapterProvider stays outside:
// the host owns its adapter (e.g. portolan's PortolanAdapter).
//
// Two opening modes, mutually exclusive:
//   - `initialSlug` — land on a fiber (the historical mode).
//   - `initialFilePath` (+ optional originId / editable / jumpToLine /
//     annotationActions / headerAnnotationActions) — land on a file. FiberPage
//     mounts FileViewerPage in the narrative slot; Workspace + Delta modes
//     are disabled (they're fiber-collection concepts). Once the user
//     navigates to a slug (wikilink, search), the workspace reverts to fiber
//     mode for the rest of the mount's life.
//
// Host usage:
//   <AdapterProvider adapter={portolanAdapter}>
//     <WorkspaceMount initialSlug="portolan/portolan" />
//   </AdapterProvider>
//
//   <AdapterProvider adapter={portolanAdapter}>
//     <WorkspaceMount initialFilePath="/abs/path/file.md" originId="local" editable />
//   </AdapterProvider>
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider, mergeRenderers } from '@myst-theme/providers';
import { DEFAULT_RENDERERS } from 'myst-to-react';
import 'react-tweet/theme.css';
import { FiberPage } from './pages/FiberPage';
import { TweetEmbedRenderer } from './components/TweetEmbed';
import { CollectionProvider } from './contexts/CollectionContext';
import { DecisionFlipProvider } from './contexts/DecisionFlipContext';
import {
  FILE_TARGET_ROUTE,
  FileTargetProvider,
  type FileTarget,
} from './contexts/FileTargetContext';
import { ModeProvider, type Mode } from './contexts/ModeContext';
import { VellumThemeProvider } from './contexts/ThemeContext';
import { WorkspaceSlotProvider } from './contexts/WorkspaceSlotContext';
import type { AnnotationAction, AnnotationBulkAction } from './utils/content-types';

const vellumRenderers = mergeRenderers(
  [
    DEFAULT_RENDERERS,
    {
      tweetEmbed: TweetEmbedRenderer,
    },
  ],
  true,
);

export interface WorkspaceMountProps {
  /** Fiber slug to land on. Mutually exclusive with `initialFilePath`. */
  initialSlug?: string;
  /** Optional eyebrow above the IndexView title — typically the host's
   *  collection or city name. Threaded through ModeProvider via context so
   *  FiberPage can hand it to IndexView without a prop chain through every
   *  view. Omit to leave the eyebrow blank. */
  eyebrow?: string;
  /** Absolute file path to open in the workspace's narrative slot, instead
   *  of a fiber slug. When set, FiberPage mounts FileViewerPage and disables
   *  the Workspace/Delta modes. Mutually exclusive with `initialSlug`. */
  initialFilePath?: string;
  /** Origin id for the file target. Forwarded to FileViewerPage's adapter calls. */
  originId?: string;
  /** When true, text/markdown files open in an editor with save controls
   *  (Save lives in the file-mode toolbar at the top of the page). */
  editable?: boolean;
  /** 1-indexed line to jump to when the file opens. */
  jumpToLine?: number;
  /** Per-annotation actions forwarded to FileViewerPage. */
  annotationActions?: AnnotationAction[];
  /** Bulk actions rendered in the file-mode toolbar when ≥1 annotation is present. */
  headerAnnotationActions?: AnnotationBulkAction[];
  /** When set, replaces `<WorkspaceView>` for the Workspace tab. The host
   *  owns the rendered surface; vellum keeps the tab chrome (FloatingIsland)
   *  and the rest of the page layout. WorkspaceAnatomy in the Canvas is
   *  also suppressed, and `--canvas-width` is dropped to 0 so the slot
   *  fills the page. Used by portolan to embed the kanban grid in vellum.
   *  Mounted lazily — only when the user is on the Workspace tab. */
  workspaceSlot?: ReactNode;
  /** Wide-layout label for the Workspace tab in FloatingIsland. Defaults to
   *  "Workspace". Hosts that swap the slot typically swap the label too
   *  (portolan: "Kanban"). */
  workspaceLabel?: string;
  /** Narrow-layout single-letter glyph for the Workspace tab. Defaults to
   *  "W". Portolan's kanban host passes "K". */
  workspaceLetter?: string;
  /** Mode to land on at first render. Defaults to 'narrative'. Hosts opening
   *  vellum on a non-narrative deep link (e.g. `initialMode: 'workspace'`
   *  paired with `workspaceSlot` for kanban-on-open) pass this. */
  initialMode?: Mode;
}

export function WorkspaceMount({
  initialSlug = '',
  eyebrow,
  initialFilePath,
  originId,
  editable,
  jumpToLine,
  annotationActions,
  headerAnnotationActions,
  workspaceSlot,
  workspaceLabel,
  workspaceLetter,
  initialMode,
}: WorkspaceMountProps) {
  // File mode wins if both are passed — prevents an ambiguous mount where
  // the URL says "fiber" but the FileTarget context says "file."
  const fileTarget: FileTarget | null = initialFilePath
    ? {
        path: initialFilePath,
        originId,
        editable,
        jumpToLine,
        annotationActions,
        headerAnnotationActions,
      }
    : null;
  const initialPath = fileTarget
    ? FILE_TARGET_ROUTE
    : initialSlug
    ? `/${initialSlug.replace(/^\/+/, '')}`
    : '/';
  return (
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ThemeProvider theme={null} setTheme={() => {}} renderers={vellumRenderers}>
        {/* VellumThemeProvider mirrors App.tsx: without it ThemePicker's
            setThemeId is the default no-op, and embedded hosts (portolan's
            workspace modal) get a theme picker that does nothing on click.
            The provider also writes data-theme onto <html>, which is the
            selector backing :root[data-theme=…] scoped CSS. */}
        <VellumThemeProvider>
          <CollectionProvider eyebrow={eyebrow}>
            <DecisionFlipProvider>
              <ModeProvider initialMode={initialMode}>
                <FileTargetProvider target={fileTarget}>
                  <WorkspaceSlotProvider
                    value={{
                      slot: workspaceSlot ?? null,
                      label: workspaceLabel ?? null,
                      letter: workspaceLetter ?? null,
                    }}
                  >
                    <Routes>
                      <Route path="/" element={<FiberPage />} />
                      <Route path="*" element={<FiberPage />} />
                    </Routes>
                  </WorkspaceSlotProvider>
                </FileTargetProvider>
              </ModeProvider>
            </DecisionFlipProvider>
          </CollectionProvider>
        </VellumThemeProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}
