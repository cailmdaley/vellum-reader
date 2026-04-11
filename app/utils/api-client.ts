/**
 * api-client — client-side fetch helpers for Vellum.
 *
 * Client components talk to mystra *through* Remix resource routes
 * (`/api/*`) on the same origin, never directly to `:3100`. The resource
 * routes in `app/routes/api.*.tsx` proxy to mystra on the server side.
 *
 * This module is safe to import from any `.tsx` in `app/components/` —
 * it uses only `window.fetch` and declares no server-only globals.
 * Do NOT import from `~/utils/content-server` here: that module is
 * server-only and will drag `process` into the client bundle.
 */

import type {
  Annotation,
  LogResponse,
  RawFiber,
  SearchHit,
} from './content-types';

function encodeSlug(slug: string): string {
  return slug.split('/').map(encodeURIComponent).join('/');
}

// ── Annotations ──────────────────────────────────────────────────────

/**
 * List annotations for a fiber, optionally filtered by kind and image src.
 * Mirrors the content-server.ts signature so callers at both layers use the
 * same API shape.
 */
export async function getAnnotations(
  slug: string,
  opts: { kind?: 'text' | 'image'; imageSrc?: string } = {},
): Promise<Annotation[]> {
  try {
    const params = new URLSearchParams({ slug });
    if (opts.kind) params.set('kind', opts.kind);
    if (opts.imageSrc) params.set('imageSrc', opts.imageSrc);
    const res = await fetch(`/api/annotations?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.annotations ?? []) as Annotation[];
  } catch {
    return [];
  }
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
}

export async function createAnnotation(
  input: CreateAnnotationInput,
): Promise<Annotation | null> {
  try {
    const res = await fetch('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.annotation ?? null) as Annotation | null;
  } catch {
    return null;
  }
}

export async function updateAnnotation(
  id: string,
  comment: string,
): Promise<Annotation | null> {
  try {
    const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.annotation ?? null) as Annotation | null;
  } catch {
    return null;
  }
}

export async function deleteAnnotation(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Raw fiber (double-click-to-edit) ─────────────────────────────────

export async function getRawFiber(slug: string): Promise<RawFiber | null> {
  try {
    const res = await fetch(`/api/fiber/${encodeSlug(slug)}`);
    if (!res.ok) return null;
    return (await res.json()) as RawFiber;
  } catch {
    return null;
  }
}

/** PUT edited markdown back to mystra via the Remix proxy. Throws on failure. */
export async function putRawFiber(slug: string, body: string): Promise<void> {
  const res = await fetch(`/api/fiber/${encodeSlug(slug)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `save failed (${res.status})`);
  }
}

// ── Search ───────────────────────────────────────────────────────────

export async function searchFibers(query: string): Promise<SearchHit[]> {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.hits ?? []) as SearchHit[];
  } catch {
    return [];
  }
}

// ── Delta log ────────────────────────────────────────────────────────

export async function getDeltaSince(since: string): Promise<LogResponse> {
  try {
    const res = await fetch(`/api/delta?since=${encodeURIComponent(since)}`);
    if (!res.ok) return { since, count: 0, events: [] };
    return (await res.json()) as LogResponse;
  } catch {
    return { since, count: 0, events: [] };
  }
}
