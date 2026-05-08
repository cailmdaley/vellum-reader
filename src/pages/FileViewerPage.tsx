/**
 * FileViewerPage — top-level vellum page for displaying a single project file.
 *
 * Fetches a `FileContent` through the active adapter and delegates rendering
 * to `FileReader`. Handles loading, empty, and error states; lets the host
 * frame the page (title bar, close button, keyboard shortcuts, routing).
 * Hosts pass the path and an optional originId; vellum has no opinion about
 * where a file lives on disk.
 *
 * When `editable` is true and the file is text/markdown, the page mounts a
 * mutable editor with a save toolbar. Save calls `adapter.saveFile` and
 * reports status in-toolbar. Non-text kinds ignore `editable`.
 *
 * This is the React surface that will eventually replace portolan's
 * FileViewerModal. During the absorption it can be mounted inside the
 * existing modal shell so hotkeys and positioning stay with portolan until
 * the dust settles.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdapter } from '../contexts/AdapterContext';
import type { Annotation, AnnotationAction, FileContent } from '../utils/content-types';
import { FileReader } from '../components/FileReader';
import { AstraPaperView, type AstraLayout } from '../components/astra/AstraPaperView';
import { AstraPicker, type AstraLadderRung } from '../components/astra/AstraPicker';
import { highlightYaml } from '../components/astra/highlight-yaml';
import { TextAnnotationLayer } from '../components/TextAnnotationLayer';
import type { AstraBundleResult } from '../adapter';

export interface FileViewerPageProps {
  path: string;
  originId?: string;
  cacheBust?: boolean;
  /** When true, text/markdown files open in an editor with save toolbar. */
  editable?: boolean;
  /** 1-indexed line to select and scroll into view once the file loads. */
  jumpToLine?: number;
  /**
   * Host-defined actions on each annotation (e.g. "send to worker", "save as
   * fiber"). Rendered inside the annotation click-popover. Optional; omit on
   * hosts that don't route annotations anywhere.
   */
  annotationActions?: AnnotationAction[];
  /**
   * Suppress the built-in save toolbar. Use when a parent shell (modal
   * header, pin-card chrome) renders its own bar — avoids two stacked bars.
   * Pair with `onDirtyChange` / `onSaveStateChange` / `onSaveReady` so the
   * host can show dirty/status/Save in its own chrome.
   */
  hideToolbar?: boolean;
  /** Fires whenever the document's dirty bit flips. Host renders its own dirty dot. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Fires whenever save state transitions (idle/saving/saved/error). */
  onSaveStateChange?: (state: SaveState) => void;
  /**
   * Handed a save trigger once the page is ready to accept one. Fires with
   * `null` when the page unmounts so the host can clear its bar. Host wires
   * its own Save button to this.
   */
  onSaveReady?: (save: (() => Promise<void>) | null) => void;
  /** Fires whenever the annotation list for this file changes. Host uses this
   * to show/hide bulk action buttons in its own chrome. */
  onAnnotationsChange?: (annotations: Annotation[]) => void;
  /** Increment to force a re-fetch of annotations from the adapter without
   * remounting the file (cursor, scroll, editor state are preserved). Use
   * after a bulk mutation (mark-sent, bulk-delete). */
  annotationRefreshKey?: number;
  /**
   * Astra-only: controlled render mode. When set, AstraFilePanel uses this
   * value and calls `onAstraRenderModeChange` instead of owning the state
   * internally. Hosts that want the source toggle in their own chrome
   * (the workspace modal's file-mode toolbar) lift this up so the toggle
   * lives in chrome while the picker stays inline content. Ignored for
   * non-astra paths. See `vellum-reader/vellum-native-astra-renderer`.
   */
  astraRenderMode?: 'rendered' | 'source';
  onAstraRenderModeChange?: (mode: 'rendered' | 'source') => void;
  /**
   * Astra-only: hint that the host adapter exposes raw YAML (`getAstraSource`).
   * AstraFilePanel internally treats `typeof adapter.getAstraSource ===
   * 'function'` as the supported flag; this prop lets a chrome-level host
   * mirror that detection so it can decide whether to render a source toggle
   * in its own toolbar before AstraFilePanel mounts. See
   * `vellum-reader/vellum-native-astra-renderer`.
   */
  onAstraSourceSupportChange?: (supported: boolean) => void;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; file: FileContent };

export type SaveState = 'idle' | 'saving' | 'saved' | { error: string };

/**
 * Match the bare or scoped `astra.yaml` form ASTRA projects use:
 * `…/astra.yaml`, `…/astra.yml`, or `…/<name>.astra.yaml`. Mirrors the
 * portolan adapter's classifier so vellum dispatches to the ladder render
 * for the same set of paths the iframe path covers today.
 *
 * Kept narrow on purpose — non-astra YAMLs (config, fixtures) stay on the
 * raw text reader. See `vellum-reader/vellum-native-astra-renderer`.
 */
export function isAstraPath(path: string): boolean {
  return /(?:^|\/)astra\.ya?ml$/i.test(path) || /\.astra\.ya?ml$/i.test(path);
}

const ASTRA_LADDER_STORAGE_KEY = 'vellum.astra.ladder';
const ASTRA_LADDER_DEFAULT: AstraLadderRung = 'linear';

function loadStoredRung(): AstraLadderRung {
  if (typeof window === 'undefined') return ASTRA_LADDER_DEFAULT;
  const raw = window.localStorage.getItem(ASTRA_LADDER_STORAGE_KEY);
  if (raw === 'paper-view' || raw === 'linear' || raw === 'personal') return raw;
  return ASTRA_LADDER_DEFAULT;
}

function persistRung(rung: AstraLadderRung): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ASTRA_LADDER_STORAGE_KEY, rung);
  } catch {
    // localStorage may throw in privacy modes; the picker still works in-memory.
  }
}

function rungToLayout(rung: AstraLadderRung): AstraLayout {
  return rung === 'personal' ? 'personal' : 'linear';
}

/**
 * Width below which the paper-view rung's iframe stops carrying useful
 * content inside a card. The lightcone paper-view template is laid out for
 * a ~720px column; below this threshold the title alone overflows
 * (e.g. only "DESI 2024 III:" shows) and the body has no room to breathe.
 *
 * Linear and personal use vellum's prose column, which adapts down to the
 * pin's `LABEL_THRESHOLD` cleanly, so when the host narrows past this floor
 * we transparently render the linear layout while leaving the picker's
 * displayed selection on `paper-view` — matches the bundle-unavailable
 * fallthrough pattern (notice + effective rung). User picks it back up at
 * any width ≥ the floor. See `vellum-reader/vellum-native-astra-renderer`
 * open question "paper-view rung in cards under tiny dimensions".
 */
const PAPER_VIEW_MIN_WIDTH = 280;

function visibleLineStorageKey(path: string, originId?: string): string {
  return `vellum:file-visible-line:${originId ?? 'local'}:${path}`;
}

function visiblePageStorageKey(path: string, originId?: string): string {
  return `vellum:file-visible-page:${originId ?? 'local'}:${path}`;
}

function loadVisibleLine(path: string, originId?: string): number | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(visibleLineStorageKey(path, originId));
    const line = raw ? Number(raw) : NaN;
    return Number.isFinite(line) && line > 0 ? line : undefined;
  } catch {
    return undefined;
  }
}

function loadVisiblePage(path: string, originId?: string): number | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(visiblePageStorageKey(path, originId));
    const page = raw ? Number(raw) : NaN;
    return Number.isFinite(page) && page > 0 ? page : undefined;
  } catch {
    return undefined;
  }
}

function saveVisibleLine(path: string, originId: string | undefined, line: number): void {
  if (typeof window === 'undefined' || !Number.isFinite(line) || line < 1) return;
  try {
    window.sessionStorage.setItem(visibleLineStorageKey(path, originId), String(Math.floor(line)));
  } catch {
    // Best-effort scroll restoration; private windows may deny storage.
  }
}

function saveVisiblePage(path: string, originId: string | undefined, page: number): void {
  if (typeof window === 'undefined' || !Number.isFinite(page) || page < 1) return;
  try {
    window.sessionStorage.setItem(visiblePageStorageKey(path, originId), String(Math.floor(page)));
  } catch {
    // Best-effort scroll restoration; private windows may deny storage.
  }
}

export function FileViewerPage(props: FileViewerPageProps) {
  // Astra paths split off into the ladder dispatch. The picker, source toggle,
  // bundle fetch, and rung-keyed render all live in `<AstraFilePanel>` so the
  // generic file-viewer code below stays focused on text/markdown/pdf/etc.
  // Non-astra paths get the existing fetch + render pipeline unchanged.
  if (isAstraPath(props.path)) {
    return <AstraFilePanel {...props} />;
  }
  return <NonAstraFileViewerPage {...props} />;
}

function NonAstraFileViewerPage({
  path,
  originId,
  cacheBust,
  editable: editableProp,
  jumpToLine,
  annotationActions,
  hideToolbar,
  onDirtyChange,
  onSaveStateChange,
  onSaveReady,
  onAnnotationsChange,
  annotationRefreshKey,
}: FileViewerPageProps) {
  const adapter = useAdapter();
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const draftRef = useRef<string>('');
  const savedToastRef = useRef<number | null>(null);
  const visibleLineRef = useRef<number | undefined>(jumpToLine ?? loadVisibleLine(path, originId));
  const [mountJumpLine, setMountJumpLine] = useState<number | undefined>(visibleLineRef.current);
  const visiblePageRef = useRef<number | undefined>(jumpToLine ?? loadVisiblePage(path, originId));
  const [mountJumpPage, setMountJumpPage] = useState<number | undefined>(visiblePageRef.current);
  // `editable` is local state so the user can flip to source mode without
  // remounting the modal page. When the host passes no explicit override,
  // non-markdown text defaults editable; parsed markdown defaults read/Pretext.
  // An explicit host value (or the toolbar Edit/Done button) takes
  // precedence after each file load.
  const [editable, setEditable] = useState<boolean>(false);
  useEffect(() => {
    if (state.status !== 'ready') return;
    if (editableProp === undefined) {
      setEditable(state.file.kind === 'text' || (state.file.kind === 'markdown' && !state.file.mdast));
      return;
    }
    setEditable(editableProp);
  }, [editableProp, state]);

  useEffect(() => {
    visibleLineRef.current = jumpToLine ?? loadVisibleLine(path, originId);
    setMountJumpLine(visibleLineRef.current);
    visiblePageRef.current = jumpToLine ?? loadVisiblePage(path, originId);
    setMountJumpPage(visiblePageRef.current);
  }, [path, originId, jumpToLine]);

  useEffect(() => {
    setMountJumpLine(visibleLineRef.current);
    setMountJumpPage(visiblePageRef.current);
  }, [cacheBust]);

  const handleVisibleLineChange = useCallback(
    (line: number) => {
      visibleLineRef.current = line;
      saveVisibleLine(path, originId, line);
    },
    [path, originId],
  );

  const handleVisiblePageChange = useCallback(
    (page: number) => {
      visiblePageRef.current = page;
      saveVisiblePage(path, originId, page);
    },
    [path, originId],
  );

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setDirty(false);
    setSaveState('idle');
    setAnnotations([]);
    adapter
      .getFile(path, { originId, cacheBust })
      .then((file) => {
        if (cancelled) return;
        if (!file) {
          setState({ status: 'empty' });
          return;
        }
        draftRef.current = file.content;
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

  // Fetch file-anchored annotations alongside the file content. Adapters that
  // don't file-anchor (lightcone) return [] and this becomes a no-op.
  useEffect(() => {
    let cancelled = false;
    adapter
      .getAnnotations(path, { kind: 'text' })
      .then((rows) => {
        if (cancelled) return;
        setAnnotations(rows.filter((a) => typeof a.from === 'number' && typeof a.to === 'number'));
      })
      .catch(() => {
        if (cancelled) return;
        setAnnotations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, path, cacheBust, annotationRefreshKey]);

  const doSave = useCallback(async () => {
    if (state.status !== 'ready') return;
    if (!editable) return;
    setSaveState('saving');
    try {
      await adapter.saveFile(state.file.path, draftRef.current, { originId });
      setDirty(false);
      setSaveState('saved');
      if (savedToastRef.current) window.clearTimeout(savedToastRef.current);
      savedToastRef.current = window.setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveState({ error: message });
    }
  }, [adapter, editable, originId, state]);

  useEffect(() => {
    return () => {
      if (savedToastRef.current) window.clearTimeout(savedToastRef.current);
    };
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onSaveStateChange?.(saveState);
  }, [saveState, onSaveStateChange]);

  useEffect(() => {
    onAnnotationsChange?.(annotations);
  }, [annotations, onAnnotationsChange]);

  useEffect(() => {
    if (!onSaveReady) return;
    const canSave = editable && state.status === 'ready' &&
      (state.file.kind === 'text' || state.file.kind === 'markdown');
    onSaveReady(canSave ? doSave : null);
    return () => onSaveReady(null);
  }, [onSaveReady, doSave, editable, state]);

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

  // Toolbar shows for any text/markdown file when the host hasn't suppressed
  // it. In read mode it carries an Edit button; in edit mode it carries the
  // dirty + save indicators plus a Done button to flip back. The hideToolbar
  // escape stays available for hosts that want to render their own bar
  // (DomPinLayer's pin chrome, for example).
  const isTextOrMd = state.file.kind === 'text' || state.file.kind === 'markdown';
  const showToolbar = !hideToolbar && isTextOrMd;

  return (
    <div
      className={`vellum-file-viewer-page${editable ? ' vellum-file-viewer-page--editable' : ''}`}
    >
      {showToolbar && (
        <div className="vellum-file-viewer-page__toolbar">
          <span className="vellum-file-viewer-page__path">
            {state.file.path}
            {dirty && <span className="vellum-file-viewer-page__dirty" aria-hidden="true"> •</span>}
          </span>
          <span className="vellum-file-viewer-page__status">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'Saved'}
            {typeof saveState === 'object' && `Error: ${saveState.error}`}
          </span>
          {editable ? (
            <>
              <button
                type="button"
                className="vellum-file-viewer-page__save"
                onClick={doSave}
                disabled={!dirty || saveState === 'saving'}
              >
                Save
              </button>
              <button
                type="button"
                className="vellum-file-viewer-page__done"
                onClick={() => {
                  // Done flips back to read view. If the buffer is dirty the
                  // canvas would otherwise show stale prose (mdast is parsed
                  // from `file.content` server-side, not the local draft) —
                  // confirm with the user so they don't silently lose work.
                  // No prompt when clean; the toggle is friction-free.
                  if (
                    dirty &&
                    !window.confirm('Discard unsaved edits and return to read view?')
                  ) {
                    return;
                  }
                  if (dirty && state.status === 'ready') {
                    draftRef.current = state.file.content;
                    setDirty(false);
                  }
                  setEditable(false);
                }}
                title="Return to read view (asks before discarding unsaved edits)"
              >
                Done
              </button>
            </>
          ) : (
            <button
              type="button"
              className="vellum-file-viewer-page__edit"
              onClick={() => setEditable(true)}
              title="Edit this file"
            >
              Edit
            </button>
          )}
        </div>
      )}
      <FileReader
        file={state.file}
        editable={editable}
        jumpToLine={mountJumpLine}
        jumpToPage={mountJumpPage}
        onVisibleLineChange={handleVisibleLineChange}
        onVisiblePageChange={handleVisiblePageChange}
        annotations={annotations}
        annotationSlug={path}
        annotationOriginId={originId}
        annotationActions={annotationActions}
        onAnnotationsChange={setAnnotations}
        onDocChange={(content) => {
          draftRef.current = content;
          setDirty(content !== state.file.content);
        }}
        onSave={doSave}
      />
    </div>
  );
}

/**
 * AstraFilePanel — vellum-native render for `astra.yaml` paths.
 *
 * Three-way ladder picker over a single bundle:
 *
 *   [ paper-view | linear | personal ]
 *
 * The picker is *content* (renders inside the body, not in chrome). The
 * source toggle is *chrome* (replaces the body with raw YAML) and lives in
 * the file-mode toolbar — it's modal-only by intent (cards don't carry a
 * source view), but the toolbar visibility honors `hideToolbar` so card
 * mounts that disable the toolbar automatically lose the source toggle too.
 *
 * Bundle is fetched once via `adapter.getAstraBundle()`. Switching ladder
 * rungs does not refetch — the same bundle drives every rung. If the
 * adapter doesn't expose `getAstraBundle` or it returns null (static deploy
 * with no pre-baked bundle yet), the panel falls back to the iframe paper-
 * view rung; the picker disables linear/personal so the user can see why.
 *
 * See `vellum-reader/vellum-native-astra-renderer`.
 */
function AstraFilePanel({
  path,
  originId,
  cacheBust,
  hideToolbar,
  astraRenderMode,
  onAstraRenderModeChange,
  onAstraSourceSupportChange,
  onAnnotationsChange,
  annotationRefreshKey,
}: FileViewerPageProps) {
  const adapter = useAdapter();
  const [rung, setRung] = useState<AstraLadderRung>(() => loadStoredRung());
  // Render mode is controlled when `astraRenderMode` is set (workspace modal
  // hoists the toggle into its file-mode chrome). Otherwise we own state
  // locally so card mounts can still flip via the inline toggle if a host
  // chooses to expose one. Today: only the modal lifts state; cards never
  // expose a source toggle (constitution: source mode is modal-only).
  const [internalRenderMode, setInternalRenderMode] = useState<'rendered' | 'source'>('rendered');
  const renderMode = astraRenderMode ?? internalRenderMode;
  const setRenderMode = (mode: 'rendered' | 'source') => {
    if (astraRenderMode === undefined) setInternalRenderMode(mode);
    onAstraRenderModeChange?.(mode);
  };
  const [iframeFile, setIframeFile] = useState<FileContent | null>(null);
  const [bundleResult, setBundleResult] = useState<AstraBundleResult | null>(null);
  const [bundleStatus, setBundleStatus] = useState<
    'idle' | 'loading' | 'ready' | 'unsupported' | 'error'
  >('idle');
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  // Internal cache-bust counter, bumped by the focus-staleness check below.
  // Combines with the host's `cacheBust` prop in every adapter call so a
  // detected external edit (window-focus → mtime changed) triggers the same
  // refetch path the host's Refresh button does. Kept distinct from `cacheBust`
  // so the host's bool prop doesn't have to round-trip through the panel.
  const [internalRefresh, setInternalRefresh] = useState(0);
  const refetchTrigger = cacheBust || internalRefresh > 0;
  // File-anchored annotations on this astra path. Loaded eagerly so they
  // light up as soon as the bundle renders. Unlike the text/markdown branch
  // (which filters by `from`/`to`), astra annotations are matched by
  // selectedText + surrounding context inside `<TextAnnotationLayer>`, so we
  // keep every row the adapter returns.
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // proseRef points at the rendered `<article>` (for text-walking inside
  // annotation matching); wrapperRef points at a sized div that wraps both
  // the article AND the `<TextAnnotationLayer>`'s margin notes, so the notes'
  // `position: absolute; left: calc(100% + 12px)` resolves against an
  // article-sized box (i.e. the notes hang in the right gutter). Anchoring
  // notes on the host (full-width) would push them past the viewport edge;
  // anchoring on the article from the outside doesn't work because the notes
  // would be DOM siblings of the article, not children, so they'd inherit a
  // different positioned ancestor.
  const proseRef = useRef<HTMLElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Host = the `.astra-paper-view-host` div the picker + body live inside.
  // Width-tracked via ResizeObserver to drive the paper-view-too-narrow
  // fallthrough below. Seeded with `Infinity` so first render picks the
  // user's actual rung (no flash of linear); the observer corrects on the
  // first paint. See `PAPER_VIEW_MIN_WIDTH`.
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [hostWidth, setHostWidth] = useState<number>(Number.POSITIVE_INFINITY);

  // Always fetch the iframe descriptor — the paper-view rung uses it
  // directly, and a missing bundle endpoint falls back to it. Cheap; the
  // adapter just hands back a `{ kind: 'html', url }` descriptor.
  useEffect(() => {
    let cancelled = false;
    adapter
      .getFile(path, { originId, cacheBust: refetchTrigger })
      .then((file) => {
        if (cancelled) return;
        setIframeFile(file && file.kind === 'html' ? file : null);
      })
      .catch(() => {
        if (cancelled) return;
        setIframeFile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, path, originId, refetchTrigger]);

  // Track the host (`.astra-paper-view-host`) width so the paper-view rung
  // can fall back to linear under narrow card sizes — see
  // `PAPER_VIEW_MIN_WIDTH`. ResizeObserver is the right primitive here: pin
  // cards resize continuously as the camera zooms, and we want the body to
  // re-render without forcing an unmount. Modal mounts hit this effect too
  // but stay well above the threshold, so the observer runs and the rung
  // never clamps. Guard for SSR / older browsers.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      setHostWidth(el.getBoundingClientRect().width);
      return;
    }
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHostWidth(entry.contentRect.width);
      }
    });
    obs.observe(el);
    setHostWidth(el.getBoundingClientRect().width);
    return () => obs.disconnect();
  }, [renderMode]);

  // Bundle fetch: only when the adapter supports it. Switching ladder rungs
  // does not retrigger this — the bundle drives every rung. cacheBust DOES
  // retrigger so a `Refresh` host action gets a fresh bundle. The internal
  // refresh counter (bumped by the focus-staleness check) flows through the
  // same `refetchTrigger`, so an external edit detected on window-focus
  // takes the same code path as a manual Refresh.
  useEffect(() => {
    if (typeof adapter.getAstraBundle !== 'function') {
      setBundleStatus('unsupported');
      setBundleResult(null);
      return;
    }
    let cancelled = false;
    setBundleStatus('loading');
    setBundleError(null);
    adapter
      .getAstraBundle(path, { originId, cacheBust: refetchTrigger })
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setBundleStatus('unsupported');
          setBundleResult(null);
          return;
        }
        setBundleResult(res);
        setBundleStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBundleError(err instanceof Error ? err.message : String(err));
        setBundleStatus('error');
        setBundleResult(null);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, path, originId, refetchTrigger]);

  // Focus-staleness check. When the user switches away and comes back to
  // the tab, poll `getAstraBundleMtime` once; if the token differs from
  // what we built against, bump the internal refresh counter (which feeds
  // `refetchTrigger`, which retriggers the bundle/iframe effects above).
  // Cheap — local: a single fs.stat; remote: a single SSH stat. Adapters
  // without `getAstraBundleMtime` no-op (the listener still attaches but
  // exits the early-return). Closes the constitution's "Bundle staleness"
  // open question for `vellum-reader/vellum-native-astra-renderer`.
  const knownMtime = bundleResult?.mtime ?? null;
  useEffect(() => {
    if (typeof adapter.getAstraBundleMtime !== 'function') return;
    if (knownMtime == null) return;
    let stopped = false;
    const onFocus = () => {
      if (stopped) return;
      void adapter
        .getAstraBundleMtime!(path, { originId })
        .then((fresh) => {
          if (stopped) return;
          if (fresh != null && fresh !== knownMtime) {
            setInternalRefresh((n) => n + 1);
          }
        })
        .catch(() => {
          // Don't bump on transient error — better to show stale than to
          // spin in a refetch loop on a flaky probe.
        });
    };
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [adapter, path, originId, knownMtime]);

  // Astra annotations: file-keyed via the path. Re-fetched on `cacheBust` and
  // on host-driven `annotationRefreshKey` bumps (bulk actions in chrome).
  // Internal-refresh bumps don't include annotations — they re-anchor by
  // selectedText + surrounding context, so they survive bundle re-renders
  // without a re-fetch.
  useEffect(() => {
    let cancelled = false;
    adapter
      .getAnnotations(path, { kind: 'text' })
      .then((rows) => {
        if (cancelled) return;
        setAnnotations(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setAnnotations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, path, cacheBust, annotationRefreshKey]);

  // Notify chrome-level hosts whenever the local list changes so they can
  // surface bulk-action affordances (e.g. "send N annotations to worker").
  useEffect(() => {
    onAnnotationsChange?.(annotations);
  }, [annotations, onAnnotationsChange]);

  // Source-mode YAML body. Lazy-loaded the first time the user flips into
  // source mode, then cached. The adapter exposes the raw-text route via
  // `getAstraSource` (separate from `getFile`, which returns the iframe URL
  // for astra paths). Hosts without a raw-text endpoint return null and the
  // source view surfaces "Could not load source"; the source toggle hides
  // entirely when the method isn't implemented at all.
  const wantsSource = renderMode === 'source';
  const supportsSource = typeof adapter.getAstraSource === 'function';

  // Notify chrome-level hosts whether the active adapter supports source
  // view. A workspace modal that wants to render its own source toggle in
  // the file-mode toolbar uses this flag to decide whether to mount the
  // toggle at all (no method → no toggle, mirroring AstraFilePanel's own
  // gating). One-shot per (adapter, support) tuple.
  useEffect(() => {
    onAstraSourceSupportChange?.(supportsSource);
  }, [onAstraSourceSupportChange, supportsSource]);
  useEffect(() => {
    if (!wantsSource || !supportsSource) return;
    let cancelled = false;
    setSourceStatus('loading');
    void (async () => {
      try {
        const text = await adapter.getAstraSource!(path, { originId, cacheBust: refetchTrigger });
        if (cancelled) return;
        if (text == null) {
          setSourceStatus('error');
          setSourceText(null);
          return;
        }
        setSourceText(text);
        setSourceStatus('ready');
      } catch (err: unknown) {
        if (cancelled) return;
        setSourceStatus('error');
        setSourceText(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // sourceStatus deliberately omitted: including it caused the effect to
    // self-cancel — `setSourceStatus('loading')` synchronously triggered a
    // re-run, whose cleanup set `cancelled = true` before the in-flight
    // fetch could commit, leaving the body stuck on "Loading…". The
    // effect should only re-fetch when the user enters source mode for a
    // (path, adapter, refetchTrigger) tuple — not when its own setState fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, wantsSource, supportsSource, path, originId, refetchTrigger]);

  const handlePick = useCallback((next: AstraLadderRung) => {
    setRung(next);
    persistRung(next);
  }, []);

  // If the bundle can't be fetched (static deploy, server error), the linear
  // and personal rungs have nothing to render — keep paper-view live and
  // clamp the rung to it. The picker still shows the disabled options so the
  // user can see they exist; clicking them is a no-op (handled in
  // `<AstraPicker>` if we choose to gate them, today they fall through to
  // the same fallback render).
  const bundleAvailable = bundleStatus === 'ready' && bundleResult != null;
  // Inverse case: paper-view *would* render but the host is too narrow for
  // the lightcone template's column to lay out anything readable. Linear
  // adapts down to the pin's label threshold cleanly, so substitute it.
  const paperViewTooNarrow =
    rung === 'paper-view' && bundleAvailable && hostWidth < PAPER_VIEW_MIN_WIDTH;
  const effectiveRung: AstraLadderRung =
    rung !== 'paper-view' && !bundleAvailable
      ? 'paper-view'
      : paperViewTooNarrow
        ? 'linear'
        : rung;

  const showToolbar = !hideToolbar;

  return (
    <div className="vellum-file-viewer-page vellum-file-viewer-page--astra">
      {showToolbar && (
        <div className="vellum-file-viewer-page__toolbar">
          <span className="vellum-file-viewer-page__path">{path}</span>
          <span className="vellum-file-viewer-page__astra-spacer" />
          {supportsSource && (
            <button
              type="button"
              className={`vellum-file-viewer-page__source-toggle${
                renderMode === 'source' ? ' vellum-file-viewer-page__source-toggle--on' : ''
              }`}
              aria-pressed={renderMode === 'source'}
              onClick={() =>
                setRenderMode(renderMode === 'source' ? 'rendered' : 'source')
              }
              title="Toggle YAML source view"
            >
              source
            </button>
          )}
        </div>
      )}
      {renderMode === 'rendered' ? (
        <div className="astra-paper-view-host" ref={hostRef}>
          <AstraPicker rung={rung} onChange={handlePick} />
          {effectiveRung !== rung && (
            <p className="astra-paper-view-host__notice" role="status">
              {paperViewTooNarrow
                ? 'paper-view needs more room — showing linear at this size.'
                : bundleStatus === 'unsupported'
                  ? 'Bundle data unavailable for this host; showing canonical paper view.'
                  : bundleStatus === 'error'
                    ? `Bundle failed to load (${bundleError ?? 'unknown error'}); showing canonical paper view.`
                    : 'Loading bundle…'}
            </p>
          )}
          {effectiveRung === 'paper-view' ? (
            iframeFile?.url ? (
              <iframe
                className="vellum-file-reader vellum-file-reader--html astra-paper-view-host__iframe"
                src={iframeFile.url}
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                title={path}
              />
            ) : (
              <div className="vellum-file-viewer-page--empty">
                Could not load <code>{path}</code>.
              </div>
            )
          ) : bundleResult ? (
            // Anchor wraps both the rendered article and TextAnnotationLayer so
            // margin notes inherit it as their offsetParent — sized exactly like
            // `.astra-paper-view` (760/920px max-width, centered) so
            // `left: calc(100% + 12px)` lands the notes 12px past the article's
            // right edge inside the host's gutter.
            <div
              className={`astra-paper-view-anchor astra-paper-view-anchor--${rungToLayout(
                effectiveRung,
              )}`}
              ref={wrapperRef}
            >
              <AstraPaperView
                bundle={bundleResult.bundle}
                csvs={bundleResult.csvs}
                layout={rungToLayout(effectiveRung)}
                hostSlug={path}
                proseRef={proseRef}
                resolveArtifact={
                  adapter.resolveAssetUrl
                    ? (p: string) => adapter.resolveAssetUrl!(p)
                    : undefined
                }
                resolvePaperPdf={(cacheKey: string) => {
                  // Origin-aware URL: `/papers/<originId>/<cacheKey>/paper.pdf`.
                  // For local origins the host's paper-cache is read directly;
                  // for remote origins, portolan SSH-fetches the PDF on first
                  // request and caches it locally per-origin (see
                  // server/src/HttpApiAstraView.ts → handlePaperPdf). The
                  // legacy single-segment form (no originId) still works as a
                  // local-origin shortcut for any caller that hasn't been
                  // updated yet.
                  const safeOrigin = encodeURIComponent(originId ?? 'local');
                  const path = `/papers/${safeOrigin}/${encodeURIComponent(cacheKey)}/paper.pdf`;
                  return adapter.resolveAssetUrl ? adapter.resolveAssetUrl(path) : path;
                }}
              />
              {/*
                * TextAnnotationLayer is a sibling of the article inside the same
                * positioned anchor div. Margin notes use `position: absolute;
                * left: calc(100% + 12px)` and resolve against the anchor — which
                * is sized like the article, so notes land in the host's right
                * gutter and clip via `overflow-x: hidden` at sticky-note widths.
                * Gated on linear/personal rungs only: the paper-view iframe is a
                * separate origin so DOM-anchored highlights can't reach inside
                * it. Annotations still exist file-keyed; they re-light when the
                * reader flips back to linear or personal.
                */}
              <TextAnnotationLayer
                slug={path}
                annotations={annotations}
                proseRef={proseRef}
                wrapperRef={wrapperRef as React.RefObject<HTMLElement>}
                onAnnotationsChange={setAnnotations}
              />
            </div>
          ) : (
            <div className="astra-paper-view-host__loading">Loading bundle…</div>
          )}
        </div>
      ) : (
        <AstraSourceView
          path={path}
          status={sourceStatus}
          text={sourceText}
        />
      )}
    </div>
  );
}

function AstraSourceView({
  path,
  status,
  text,
}: {
  path: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  text: string | null;
}) {
  if (status === 'loading' || status === 'idle') {
    return (
      <div className="vellum-file-viewer-page vellum-file-viewer-page--loading">
        Loading {path}…
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="vellum-file-viewer-page vellum-file-viewer-page--error">
        Could not load source for <code>{path}</code>
        {text ? `: ${text}` : '.'}
      </div>
    );
  }
  // Syntax-highlight the YAML body via vellum's local tokenizer (no external
  // dep). One <span> per token, one row per line — matches the constitution's
  // "Source view (raw YAML, syntax-coloured)" promise. See
  // `vellum-reader/vellum-native-astra-renderer`.
  const lines = highlightYaml(text ?? '');
  return (
    <pre className="vellum-file-reader vellum-file-reader--text astra-source-view">
      <code>
        {lines.map((spans, i) => (
          <span key={i} className="astra-source-view__line">
            {spans.map((span, j) => (
              <span
                key={j}
                className={span.cls ?? undefined}
              >
                {span.text}
              </span>
            ))}
            {i < lines.length - 1 ? '\n' : ''}
          </span>
        ))}
      </code>
    </pre>
  );
}
