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
import { useEffect, useRef, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
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
import { ModeProvider, useMode, type Mode } from './contexts/ModeContext';
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
   *  collection name. Threaded through ModeProvider via context so
   *  FiberPage can hand it to IndexView without a prop chain through every
   *  view. Omit to leave the eyebrow blank. */
  eyebrow?: string;
  /** Invoked when the user clicks the thumb-index `← index` button while
   *  sitting at the *top* of this collection's local graph (a root fiber
   *  with no parent). Lets the embedding host (e.g. portolan) treat that
   *  click as "escape upward one scope level" — typically by closing this
   *  modal and remounting vellum against a higher-level synthetic
   *  collection (the global Vellum index). Omit to keep the button's
   *  current local-only behaviour (`navigate('')`, which the FiberPage
   *  rootSlug-redirect bounces back from when a root fiber exists). */
  onIndexEscalate?: () => void;
  /** Invoked when the user clicks any node whose slug starts with `__`
   *  — a host-synthetic collection gateway. Embedding hosts can use this
   *  to remount vellum on the destination collection so the user gets that
   *  collection's full graph and populated thumb-index, rather than
   *  treating the synthetic slug as an ordinary in-collection fiber.
   *
   *  When omitted, synthetic-slug clicks fall through to ordinary
   *  in-mount `navigate`, which is the right thing for vanilla vellum
   *  (no synthetic nodes) and a degraded-but-functional fallback for
   *  hosts that haven't wired the prop yet. */
  onOpenSyntheticNode?: (slug: string) => void;
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
  /** When set, fills the Find tab's body. The Find tab is always rendered
   *  in vellum's mode strip; without a slot it renders an empty placeholder.
   *  Used by portolan to embed the Find tab (Spatial section + cross-project
   *  fiber tree/search/recents) inside vellum. Mounted lazily — only when
   *  the user is on the Find tab. */
  findSlot?: ReactNode;
  /** Wide-layout label for the Find tab in FloatingIsland. Defaults to "Find". */
  findLabel?: string;
  /** Narrow-layout single-letter glyph for the Find tab. Defaults to "F". */
  findLetter?: string;
  /** Mode to land on at first render. Defaults to 'narrative'. Hosts opening
   *  vellum on a non-narrative deep link (e.g. `initialMode: 'workspace'`
   *  paired with `workspaceSlot` for kanban-on-open, or `initialMode: 'find'`
   *  paired with `findSlot` for portolan's Find tab) pass this. */
  initialMode?: Mode;
  /** Callback invoked once on mount with a host-facing API for the embedded
   *  workspace: flip mode, read mode, navigate to a slug. Used by hosts (e.g.
   *  portolan) that need to drive the workspace from outside the React tree —
   *  for example, a global `k` hotkey that flips an open workspace to the
   *  Kanban tab in place. The api object is stable across re-renders; called
   *  again with `null` on unmount so callers can drop their reference. */
  apiRef?: (api: WorkspaceMountApi | null) => void;
}

/** Host-facing handle returned from `apiRef`. */
export interface WorkspaceMountApi {
  /** Flip the active mode. */
  setMode: (mode: Mode) => void;
  /** Read the current mode. Returns the latest committed value. */
  getMode: () => Mode;
  /** Navigate the embedded workspace's MemoryRouter to a fiber path. Pass a
   *  bare slug (e.g. `'portolan/portolan'`) — the leading `/` is added if
   *  absent. */
  navigate: (slug: string) => void;
}

export function WorkspaceMount({
  initialSlug = '',
  eyebrow,
  onIndexEscalate,
  onOpenSyntheticNode,
  initialFilePath,
  originId,
  editable,
  jumpToLine,
  annotationActions,
  headerAnnotationActions,
  workspaceSlot,
  workspaceLabel,
  workspaceLetter,
  findSlot,
  findLabel,
  findLetter,
  initialMode,
  apiRef,
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
          <CollectionProvider eyebrow={eyebrow} onIndexEscalate={onIndexEscalate} onOpenSyntheticNode={onOpenSyntheticNode}>
            <DecisionFlipProvider>
              <ModeProvider initialMode={initialMode}>
                <FileTargetProvider target={fileTarget}>
                  <WorkspaceSlotProvider
                    value={{
                      slot: workspaceSlot ?? null,
                      label: workspaceLabel ?? null,
                      letter: workspaceLetter ?? null,
                      findSlot: findSlot ?? null,
                      findLabel: findLabel ?? null,
                      findLetter: findLetter ?? null,
                    }}
                  >
                    <Routes>
                      <Route path="/" element={<FiberPage />} />
                      <Route path="*" element={<FiberPage />} />
                    </Routes>
                    {/* Bridge that hands setMode + navigate out to embedding
                        hosts (apiRef). Renders nothing; lives inside
                        ModeProvider + MemoryRouter so it can call useMode
                        and useNavigate. Skipped entirely when no apiRef is
                        passed so vellum's standalone App.tsx pays no cost. */}
                    {apiRef ? <WorkspaceApiBridge apiRef={apiRef} /> : null}
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

/**
 * Internal bridge that surfaces `setMode` / `navigate` / `getMode` to a host
 * outside the React tree via the `apiRef` callback. Renders nothing.
 *
 * Lives as a sibling of <Routes> so it can call `useMode()` (under
 * ModeProvider) and `useNavigate()` (under MemoryRouter) without re-entering
 * either provider. The api object is rebuilt whenever `setMode` or `navigate`
 * change identity (in practice: mount once, since both are stable). A
 * `modeRef` keeps `getMode()` reading the *latest* mode without forcing the
 * api object to be rebuilt on every mode change.
 *
 * Cleanup pushes `null` to the host so a closed modal's stale handle can't
 * accidentally drive a new modal.
 */
function WorkspaceApiBridge({
  apiRef,
}: {
  apiRef: (api: WorkspaceMountApi | null) => void;
}) {
  const { mode, setMode } = useMode();
  const navigate = useNavigate();
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    const api: WorkspaceMountApi = {
      setMode,
      getMode: () => modeRef.current,
      navigate: (slug) => navigate(slug.startsWith('/') ? slug : `/${slug}`),
    };
    apiRef(api);
    return () => apiRef(null);
  }, [apiRef, setMode, navigate]);
  return null;
}
