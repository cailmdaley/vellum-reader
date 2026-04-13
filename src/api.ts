import type {
  Annotation,
  AstraGraph,
  FiberContent,
  LogResponse,
  RawFiber,
  SearchHit,
} from './utils/content-types';

function encodeSlug(slug: string): string {
  return slug.split('/').map(encodeURIComponent).join('%2F');
}

export async function getFiberContent(slug: string): Promise<FiberContent | null> {
  const res = await fetch(`/content/${encodeSlug(slug)}.json`).catch(() => null);
  if (!res || res.status === 404 || !res.ok) return null;
  return res.json() as Promise<FiberContent>;
}

export async function getAstraGraph(): Promise<AstraGraph> {
  const res = await fetch('/astra-graph.json').catch(() => null);
  if (!res || res.status === 404 || !res.ok) return { nodes: [], links: [] };
  return res.json() as Promise<AstraGraph>;
}

export async function searchFibers(query: string): Promise<SearchHit[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`).catch(() => null);
  if (!res || !res.ok) return [];
  const data = await res.json();
  return (data.hits ?? []) as SearchHit[];
}

export async function getDeltaSince(since: string, limit = 200): Promise<LogResponse> {
  const params = new URLSearchParams({ since, limit: String(limit) });
  const res = await fetch(`/api/log?${params}`).catch(() => null);
  if (!res || !res.ok) return { since, count: 0, events: [] };
  return res.json() as Promise<LogResponse>;
}

export async function getAnnotations(
  slug: string,
  opts: { kind?: 'text' | 'image'; imageSrc?: string } = {},
): Promise<Annotation[]> {
  const params = new URLSearchParams({ slug });
  if (opts.kind) params.set('kind', opts.kind);
  if (opts.imageSrc) params.set('imageSrc', opts.imageSrc);
  const res = await fetch(`/api/annotations?${params}`).catch(() => null);
  if (!res || !res.ok) return [];
  const data = await res.json();
  return (data.annotations ?? []) as Annotation[];
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

export async function createAnnotation(input: CreateAnnotationInput): Promise<Annotation | null> {
  const res = await fetch('/api/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json();
  return (data.annotation ?? null) as Annotation | null;
}

export async function updateAnnotation(id: string, comment: string): Promise<Annotation | null> {
  const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json();
  return (data.annotation ?? null) as Annotation | null;
}

export async function deleteAnnotation(id: string): Promise<boolean> {
  const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).catch(() => null);
  return !!res?.ok;
}

export async function getRawFiber(slug: string): Promise<RawFiber | null> {
  const res = await fetch(`/content/${encodeSlug(slug)}.md`).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json() as Promise<RawFiber>;
}

export interface FrontmatterPatch {
  tempered?: boolean;
  status?: 'open' | 'active' | 'closed' | 'unresolved' | 'blocked';
}

export async function patchFiberFrontmatter(slug: string, patch: FrontmatterPatch): Promise<void> {
  const res = await fetch(`/content/${encodeSlug(slug)}.md`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frontmatter: patch }),
  }).catch(() => null);

  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({})) as { error?: string } | undefined;
    throw new Error(err?.error ?? `patch failed${res ? ` (${res.status})` : ''}`);
  }
}

export async function putRawFiber(slug: string, body: string): Promise<void> {
  const res = await fetch(`/content/${encodeSlug(slug)}.md`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  }).catch(() => null);

  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({})) as { error?: string } | undefined;
    throw new Error(err?.error ?? `save failed${res ? ` (${res.status})` : ''}`);
  }
}
