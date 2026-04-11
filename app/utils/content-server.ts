/**
 * Fetch helpers for MySTRA content server at :3100.
 *
 * SERVER-ONLY. These functions run inside Remix loaders/actions and talk
 * directly to mystra over HTTP. Client components must not import this
 * module (not even for types — use `~/utils/content-types` for that and
 * `~/utils/api-client` for browser-side network calls).
 *
 * `process.env` must stay behind a getter. Remix's client bundle
 * tree-shakes unused loader imports from `~.tsx` route modules, but if
 * ANY code path in this file evaluates at module init time it breaks that
 * shake and the whole module (process.env and all) lands in the browser.
 * That's what the `ReferenceError: process is not defined` in
 * `$-*.js` was: the top-level `CONTENT_CDN = process.env[...]` assignment
 * was evaluated eagerly.
 *
 * Node 18+ has globalThis.fetch — no need for node-fetch.
 */

import type {
  Annotation,
  AstraGraph,
  FiberContent,
  LogResponse,
  RawFiber,
  SearchHit,
} from './content-types';

/**
 * Lazily resolve the CDN origin. Must NOT be a top-level const: top-level
 * evaluation is a module side effect the bundler cannot drop, and it
 * turns this server-only module into a client-bundle crash
 * (`ReferenceError: process is not defined`) when Remix can't tree-shake
 * the import out of the `$.tsx` client chunk.
 */
export function cdnOrigin(): string {
  return (
    process.env['CONTENT_CDN'] ??
    `http://localhost:${process.env['CONTENT_CDN_PORT'] ?? 3100}`
  );
}

/**
 * Fetch a fiber's content by slug.
 * Tries /content/{slug}.json with path segments URL-encoded.
 */
export async function getFiberContent(slug: string): Promise<FiberContent | null> {
  const encodedSlug = slug.split('/').map(encodeURIComponent).join('%2F');
  const url = `${cdnOrigin()}/content/${encodedSlug}.json`;
  const res = await fetch(url).catch(() => null);
  if (!res || res.status === 404) return null;
  if (!res.ok) return null;
  return res.json() as Promise<FiberContent>;
}

/** Fetch the full ASTRA graph (nodes + links) for margin citation glyphs. */
export async function getAstraGraph(): Promise<AstraGraph> {
  const url = `${cdnOrigin()}/astra-graph.json`;
  const res = await fetch(url).catch(() => null);
  if (!res || res.status === 404) return { nodes: [], links: [] };
  return res.json() as Promise<AstraGraph>;
}

/** Search fibers (for the header search box). */
export async function searchFibers(query: string): Promise<SearchHit[]> {
  const url = `${cdnOrigin()}/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return [];
  const data: any = await res.json();
  return data.hits ?? [];
}

/**
 * Get annotations for a slug, optionally filtered by kind ('text' | 'image')
 * and an image src pathname. mystra does the filtering server-side; we just
 * forward whatever the caller gives us.
 */
export async function getAnnotations(
  slug: string,
  opts: { kind?: 'text' | 'image'; imageSrc?: string } = {},
): Promise<Annotation[]> {
  const params = new URLSearchParams({ slug });
  if (opts.kind) params.set('kind', opts.kind);
  if (opts.imageSrc) params.set('imageSrc', opts.imageSrc);
  const res = await fetch(`${cdnOrigin()}/api/annotations?${params}`).catch(() => null);
  if (!res || !res.ok) return [];
  const data: any = await res.json();
  return data.annotations ?? [];
}

/** Create a new annotation. */
export async function createAnnotation(input: {
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
}): Promise<Annotation | null> {
  const url = `${cdnOrigin()}/api/annotations`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data: any = await res.json();
  return data.annotation ?? null;
}

/** Update an annotation's comment. */
export async function updateAnnotation(id: string, comment: string): Promise<Annotation | null> {
  const url = `${cdnOrigin()}/api/annotations/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data: any = await res.json();
  return data.annotation ?? null;
}

/** Delete an annotation. */
export async function deleteAnnotation(id: string): Promise<boolean> {
  const url = `${cdnOrigin()}/api/annotations/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: 'DELETE' }).catch(() => null);
  if (!res || !res.ok) return false;
  return true;
}

/**
 * Raw markdown read — used by the inline double-click editor.
 * Returns the full file contents (frontmatter + body) plus a sha256.
 */
export async function getRawFiber(slug: string): Promise<RawFiber | null> {
  const encodedSlug = slug.split('/').map(encodeURIComponent).join('%2F');
  const url = `${cdnOrigin()}/content/${encodedSlug}.md`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json() as Promise<RawFiber>;
}

/**
 * PUT the edited file back to mystra, which writes to disk atomically.
 * The mystra file watcher then fires a RELOAD over the dev WebSocket and
 * vellum revalidates, so the caller does not need to re-fetch anything.
 */
export async function putRawFiber(slug: string, body: string): Promise<RawFiber | null> {
  const encodedSlug = slug.split('/').map(encodeURIComponent).join('%2F');
  const url = `${cdnOrigin()}/content/${encodedSlug}.md`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json() as Promise<RawFiber>;
}

/** Fetch log events since a given timestamp. */
export async function getLogEvents(since?: string): Promise<LogResponse> {
  const params = since ? `?since=${encodeURIComponent(since)}` : '';
  const url = `${cdnOrigin()}/api/log${params}`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return { since: since ?? null, count: 0, events: [] };
  return res.json() as Promise<LogResponse>;
}
