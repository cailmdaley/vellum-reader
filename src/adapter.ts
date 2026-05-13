/**
 * Vellum data Adapter interface.
 *
 * The seam through which a host (local dev server, Portolan main app, static
 * tapestry viewer) provides data to Vellum's components. The adapter owns all
 * network / storage / protocol specifics; Vellum consumes shape only.
 *
 * This file is the source of truth for the adapter surface. `src/api.ts` is
 * the local HTTP implementation and will be repositioned as a named factory
 * in a subsequent step.
 *
 * ## Design notes
 *
 * - Data-only. Routing (link resolution, history) stays with the host.
 * - Every method returns either a successful value or a well-typed "empty"
 *   sentinel (`null`, `[]`, `{ ... count: 0 }`). Vellum never needs to
 *   distinguish network failure from absent content.
 * - Mutation methods (`createAnnotation`, `putRawFiber`, etc.) may throw for
 *   genuine failures; their error surface is simple `Error(message)`.
 * - If a host has no meaningful implementation for a method (e.g. the static
 *   viewer has no writes), it can throw a structured `ReadOnlyAdapterError`
 *   — see below.
 *
 * ## Subset adapters
 *
 * Hosts that are read-only (the static tapestry viewer) can implement a
 * `ReadOnlyAdapter` and pass it via a narrower prop. Components that perform
 * writes must branch on capability before calling write methods.
 */

import type {
  Annotation,
  FiberGraph,
  FiberContent,
  FileContent,
  HistoryResponse,
  LogResponse,
  RawFiber,
  SearchHit,
} from './utils/content-types';

export interface CreateAnnotationInput {
  slug: string;
  kind?: 'text' | 'image';
  intent?: 'note' | 'delete';
  selectedText?: string;
  contextBefore?: string;
  contextAfter?: string;
  comment: string;
  paragraphIndex?: number;
  x?: number;
  y?: number;
  imageSrc?: string;
  // File-anchoring fields (portolan code-file annotations). Hosts that
  // anchor by fiber paragraph leave these undefined; portolan sets them
  // when the user selects code inside FileReader.
  filePath?: string;
  originId?: string;
  from?: number;
  to?: number;
  line?: number;
  endLine?: number;
  originalText?: string;
}

export interface FrontmatterPatch {
  tempered?: boolean;
  status?: 'open' | 'active' | 'closed' | 'unresolved' | 'blocked';
}

export interface GetAnnotationsOptions {
  kind?: 'text' | 'image';
  imageSrc?: string;
}

export interface GetFileOptions {
  /** Origin the file lives under (portolan: local vs remote-hostname). */
  originId?: string;
  /** Bust upstream caches when true (e.g. after a save elsewhere). */
  cacheBust?: boolean;
}

export interface SaveFileOptions {
  /** Origin the file lives under (portolan: local vs remote-hostname). */
  originId?: string;
}

export interface ReadOnlyAdapter {
  getFiberContent(slug: string): Promise<FiberContent | null>;
  getFiberGraph(): Promise<FiberGraph>;
  getRawFiber(slug: string): Promise<RawFiber | null>;
  getAnnotations(slug: string, opts?: GetAnnotationsOptions): Promise<Annotation[]>;
  searchFibers(query: string): Promise<SearchHit[]>;
  getDeltaSince(since: string, limit?: number): Promise<LogResponse>;
  /**
   * Felt history chain for a fiber — editorial summaries (per-session
   * prose) plus mechanical events (saves, edits, the bootstrap add).
   * Newest-first.
   *
   * Returns a `HistoryResponse` with status info: `'ok'` for a
   * canonical events list (possibly empty), `'unavailable'` when the
   * fetch failed (felt index busy, felt missing, host without history
   * support). The HistoryCard distinguishes these states so a transient
   * felt-busy error doesn't look like "no history."
   */
  getFiberHistory(slug: string): Promise<HistoryResponse>;
  /**
   * Load an arbitrary project file by path. Distinct from `getFiberContent`,
   * which is slug-keyed and myst-rendered. Hosts that expose no generic file
   * surface (e.g. lightcone) return `null`.
   */
  getFile(path: string, opts?: GetFileOptions): Promise<FileContent | null>;
}

export interface Adapter extends ReadOnlyAdapter {
  createAnnotation(input: CreateAnnotationInput): Promise<Annotation | null>;
  updateAnnotation(id: string, comment: string): Promise<Annotation | null>;
  deleteAnnotation(id: string): Promise<boolean>;
  patchFiberFrontmatter(slug: string, patch: FrontmatterPatch): Promise<void>;
  putRawFiber(slug: string, body: string): Promise<void>;
  /**
   * Write an arbitrary project file. Distinct from `putRawFiber`, which is
   * slug-keyed. Hosts that do not expose file writes (e.g. lightcone) should
   * throw `ReadOnlyAdapterError`.
   */
  saveFile(path: string, content: string, opts?: SaveFileOptions): Promise<void>;
}

export class ReadOnlyAdapterError extends Error {
  constructor(method: string) {
    super(`Adapter is read-only; cannot invoke ${method}`);
    this.name = 'ReadOnlyAdapterError';
  }
}

/**
 * Wrap a ReadOnlyAdapter as a full Adapter whose write methods throw.
 * Useful when a component tree expects Adapter but the host is truly read-only
 * (e.g. the static tapestry deploy).
 */
export function asReadOnlyAdapter(ro: ReadOnlyAdapter): Adapter {
  return {
    ...ro,
    createAnnotation: () => {
      throw new ReadOnlyAdapterError('createAnnotation');
    },
    updateAnnotation: () => {
      throw new ReadOnlyAdapterError('updateAnnotation');
    },
    deleteAnnotation: () => {
      throw new ReadOnlyAdapterError('deleteAnnotation');
    },
    patchFiberFrontmatter: () => {
      throw new ReadOnlyAdapterError('patchFiberFrontmatter');
    },
    putRawFiber: () => {
      throw new ReadOnlyAdapterError('putRawFiber');
    },
    saveFile: () => {
      throw new ReadOnlyAdapterError('saveFile');
    },
  };
}
