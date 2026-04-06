/**
 * Fetch helpers for MySTRA content server at :3100
 * Vellum is a pure client — it reads but never writes to .felt/
 */

import fetch from 'node-fetch';

const CONTENT_CDN = process.env.CONTENT_CDN ?? `http://localhost:${process.env.CONTENT_CDN_PORT ?? 3100}`;

export interface FiberContent {
  slug: string;
  kind?: string;
  mdast: any;
  frontmatter: Record<string, any>;
  references?: any;
  dependencies?: string[];
}

export interface AstraGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface GraphFinding {
  key: string;
  claim: string;
  hasEvidence: boolean;
}

export interface GraphNode {
  id: string;
  label: string;
  slug: string;
  kind?: string;
  status: string;
  tags: string[];
  verdict?: string;
  decisions?: GraphDecision[];
  findings?: GraphFinding[];
  decisionCount?: number;
  findingCount?: number;
  tempered?: boolean;
  depth?: number;
  narrative?: boolean;
  hasASTRA?: boolean;
}

export interface GraphDecision {
  key: string;
  label: string;
  rationale?: string;
  selectedKey?: string;
  selectedLabel?: string;
  excluded: Array<{ key: string; label: string; reason?: string }>;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: 'contains' | 'data-flow' | 'cites';
}

/**
 * Fetch a fiber's content by slug.
 * Tries /content/{slug}.json first (flat), then /content/{...slug parts}.json (wildcard).
 */
export async function getFiberContent(slug: string): Promise<FiberContent | null> {
  // Content server expects encoded slashes for nested slugs
  const encodedSlug = slug.split('/').map(encodeURIComponent).join('%2F');
  const url = `${CONTENT_CDN}/content/${encodedSlug}.json`;
  const res = await fetch(url).catch(() => null);
  if (!res || res.status === 404) return null;
  if (!res.ok) return null;
  return res.json() as Promise<FiberContent>;
}

/** Fetch the full ASTRA graph (nodes + links) for margin citation glyphs. */
export async function getAstraGraph(): Promise<AstraGraph> {
  const url = `${CONTENT_CDN}/astra-graph.json`;
  const res = await fetch(url).catch(() => null);
  if (!res || res.status === 404) return { nodes: [], links: [] };
  return res.json() as Promise<AstraGraph>;
}

export interface SearchHit {
  id: string;
  title: string;
  status: string;
  tags: string[];
  snippet?: string;
  outcome?: string;
  score: number;
}

/** Search fibers (for the header search box). */
export async function searchFibers(query: string): Promise<SearchHit[]> {
  const url = `${CONTENT_CDN}/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return [];
  const data: any = await res.json();
  return data.hits ?? [];
}

/** Annotation shape from the content server. */
export interface Annotation {
  id: string;
  slug: string;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  comment: string;
  createdAt: number;
  author?: string;
  paragraphIndex?: number;
}

/** Get all annotations for a slug. */
export async function getAnnotations(slug: string): Promise<Annotation[]> {
  const url = `${CONTENT_CDN}/api/annotations?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return [];
  const data: any = await res.json();
  return data.annotations ?? [];
}

/** Create a new annotation. */
export async function createAnnotation(input: {
  slug: string;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  comment: string;
  paragraphIndex?: number;
}): Promise<Annotation | null> {
  const url = `${CONTENT_CDN}/api/annotations`;
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
  const url = `${CONTENT_CDN}/api/annotations/${encodeURIComponent(id)}`;
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
  const url = `${CONTENT_CDN}/api/annotations/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: 'DELETE' }).catch(() => null);
  if (!res || !res.ok) return false;
  return true;
}

export interface LogEvent {
  at: string;
  type: string;
  fiberId: string;
  title: string;
  status: string;
  tags: string[];
  outcome?: string;
}

export interface LogResponse {
  since: string | null;
  count: number;
  events: LogEvent[];
}

/** Fetch log events since a given timestamp. */
export async function getLogEvents(since?: string): Promise<LogResponse> {
  const params = since ? `?since=${encodeURIComponent(since)}` : '';
  const url = `${CONTENT_CDN}/api/log${params}`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return { since: since ?? null, count: 0, events: [] };
  return res.json() as Promise<LogResponse>;
}
