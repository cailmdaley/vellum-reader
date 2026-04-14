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

import type {
  Annotation,
  AstraGraph,
  FiberContent,
  FileContent,
  LogResponse,
  RawFiber,
  SearchHit,
} from './utils/content-types';

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
}

export interface Adapter extends ReadOnlyAdapter {
  createAnnotation(input: CreateAnnotationInput): Promise<Annotation | null>;
  updateAnnotation(id: string, comment: string): Promise<Annotation | null>;
  deleteAnnotation(id: string): Promise<boolean>;
  patchFiberFrontmatter(slug: string, patch: FrontmatterPatch): Promise<void>;
  putRawFiber(slug: string, body: string): Promise<void>;
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
  };
}
