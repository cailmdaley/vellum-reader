/**
 * Vellum data Adapter interface.
 *
 * The seam through which a host (lightcone, portolan main app, portolan static
 * tapestry viewer) provides data to Vellum's components. The adapter owns all
 * network / storage / protocol specifics; Vellum consumes shape only.
 *
 * This file is the source of truth for the adapter surface. `src/api.ts` is
 * the lightcone-specific implementation (HTTP calls to the lightcone backend)
 * and will be repositioned as `createLightconeAdapter()` in a subsequent step.
 *
 * ## Design notes
 *
 * - Data-only. Routing (link resolution, history) stays with the host.
 * - Every method returns either a successful value or a well-typed "empty"
 *   sentinel (`null`, `[]`, `{ ... count: 0 }`). Vellum never needs to
 *   distinguish network failure from absent content.
 * - Mutation methods (`createAnnotation`, `putRawFiber`, etc.) may throw for
 *   genuine failures; their error surface is simple `Error(message)`.
 * - Adapter shape deliberately mirrors the lightcone `api.ts` signatures so
 *   the refactor is mechanical. If a host has no meaningful implementation
 *   for a method (e.g. the static viewer has no writes), it can throw a
 *   structured `ReadOnlyAdapterError` — see below.
 *
 * ## Subset adapters
 *
 * Hosts that are read-only (the static tapestry viewer) can implement a
 * `ReadOnlyAdapter` and pass it via a narrower prop. Components that perform
 * writes must branch on capability before calling write methods.
 */

import type { Bundle } from 'lightcone-ui-core';
import type {
  Annotation,
  AstraGraph,
  FiberContent,
  FileContent,
  LogResponse,
  RawFiber,
  SearchHit,
} from './utils/content-types';

/**
 * Result of {@link ReadOnlyAdapter.getAstraBundle}: the rewritten Bundle
 * (artifact paths point at host-resolvable URLs) plus inlined CSV previews
 * for table-typed outputs. Identical shape to lightcone-ui-core's `BuildResult`
 * but kept separate so vellum's adapter surface doesn't pull the cli build
 * machinery — only the data types.
 */
export interface AstraBundleResult {
  bundle: Bundle;
  csvs: Record<string, string>;
}

export interface GetAstraBundleOptions {
  /** Origin the astra.yaml lives under (portolan: 'local' vs remote-hostname). */
  originId?: string;
  /** Universe id to build against; default `"baseline"` per lightcone-ui-core. */
  universe?: string;
  /** Bust upstream caches when true. */
  cacheBust?: boolean;
}

export interface CreateAnnotationInput {
  slug: string;
  kind?: 'text' | 'image';
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
  getAstraGraph(): Promise<AstraGraph>;
  getRawFiber(slug: string): Promise<RawFiber | null>;
  getAnnotations(slug: string, opts?: GetAnnotationsOptions): Promise<Annotation[]>;
  searchFibers(query: string): Promise<SearchHit[]>;
  getDeltaSince(since: string, limit?: number): Promise<LogResponse>;
  /**
   * Load an arbitrary project file by path. Distinct from `getFiberContent`,
   * which is slug-keyed and myst-rendered. Hosts that expose no generic file
   * surface (e.g. lightcone) return `null`.
   */
  getFile(path: string, opts?: GetFileOptions): Promise<FileContent | null>;
  /**
   * Load the paper-view Bundle for an astra.yaml. Optional because hosts
   * without a buildBundle pipeline (lightcone standalone, the static
   * tapestry deploy until bundle JSON is pre-baked) can omit it; the
   * vellum-native astra renderer falls back to the iframe paper-view rung
   * when the method is missing or returns `null`.
   *
   * Returns the rewritten Bundle (artifact paths resolved to host URLs)
   * plus inlined CSV previews. See `vellum-reader/vellum-native-astra-renderer`.
   */
  getAstraBundle?(path: string, opts?: GetAstraBundleOptions): Promise<AstraBundleResult | null>;
  /**
   * Read the raw YAML text for an astra.yaml path. Powers the astra renderer's
   * source-view chrome toggle (modal-only). Optional because the same hosts
   * that lack `getAstraBundle` typically also lack a raw-text endpoint;
   * vellum hides the source toggle when the adapter doesn't implement this.
   *
   * `getFile` returns the iframe URL for astra paths (so the rendered rung
   * can iframe the canonical paper-view); the source view needs the bytes,
   * not a URL, which is why this is a separate method.
   */
  getAstraSource?(path: string, opts?: GetFileOptions): Promise<string | null>;
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
