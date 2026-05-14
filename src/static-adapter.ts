import Fuse from 'fuse.js';
import type { IFuseOptions } from 'fuse.js';
import type {
  Annotation,
  FiberContent,
  FiberGraph,
  FileContent,
  HistoryResponse,
  LogResponse,
  RawFiber,
  SearchHit,
} from './utils/content-types';
import type { ReadOnlyAdapter } from './adapter';

interface SearchDocument {
  id: string;
  title: string;
  status: string;
  tags: string[];
  outcome?: string;
  body: string;
}

interface SearchIndexPayload {
  documents: SearchDocument[];
  index: Record<string, any>;
}

const FUSE_OPTIONS: IFuseOptions<SearchDocument> = {
  includeScore: true,
  threshold: 0.36,
  ignoreLocation: true,
  minMatchCharLength: 2,
  keys: [
    { name: 'title', weight: 2.0 },
    { name: 'outcome', weight: 1.4 },
    { name: 'body', weight: 1.0 },
    { name: 'tags', weight: 0.6 },
    { name: 'id', weight: 0.2 },
  ],
};

declare global {
  interface Window {
    __VELLUM_STATIC__?: {
      siteBase?: string;
      publicationBase?: string;
    };
  }
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function readStaticConfig(): Window['__VELLUM_STATIC__'] | undefined {
  return typeof window === 'undefined' ? undefined : window.__VELLUM_STATIC__;
}

function inferredSiteBase(): string {
  // The bundled script lives at <siteBase>/_vellum/assets/<file>.js. Up two
  // directories from there is the site base. Three was a long-standing
  // off-by-one that resolved to '/' on Pages and made the SPA fallback in
  // 404.html lose its basename — slugs ended up including 'tapestries/'.
  const siteBase = trimTrailingSlash(
    new URL(/* @vite-ignore */ '../..', import.meta.url).pathname,
  );
  return siteBase || '/';
}

function currentSiteBase(): string {
  const configured = readStaticConfig()?.siteBase;
  return trimTrailingSlash(configured || inferredSiteBase()) || '/';
}

function publicationRootFromPath(pathname: string): string | null {
  const siteBase = currentSiteBase();
  const relative = pathname.startsWith(siteBase)
    ? pathname.slice(siteBase.length)
    : pathname;
  const first = relative.split('/').filter(Boolean)[0];
  return first ?? null;
}

function publicationBasePath(pathname = window.location.pathname): string | null {
  const configured = readStaticConfig()?.publicationBase;
  if (configured) return ensureTrailingSlash(configured);
  const root = publicationRootFromPath(pathname);
  return root ? `${trimTrailingSlash(currentSiteBase())}/${root}/` : null;
}

function encodeSlugPath(slug: string): string {
  return slug
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url).catch(() => null);
  if (!res || res.status === 404 || !res.ok) return null;
  return res.json() as Promise<T>;
}

export function createStaticAdapter(): ReadOnlyAdapter {
  const graphCache = new Map<string, Promise<FiberGraph>>();
  const searchCache = new Map<string, Promise<Fuse<SearchDocument>>>();

  const getGraph = (basePath: string): Promise<FiberGraph> => {
    const cached = graphCache.get(basePath);
    if (cached) return cached;
    const pending = fetchJson<FiberGraph>(`${basePath}fiber-graph.json`).then(
      (graph) => graph ?? { nodes: [], links: [] },
    );
    graphCache.set(basePath, pending);
    return pending;
  };

  const getFuse = (basePath: string): Promise<Fuse<SearchDocument>> => {
    const cached = searchCache.get(basePath);
    if (cached) return cached;
    const pending = fetchJson<SearchIndexPayload>(`${basePath}search-index.json`).then((payload) => {
      const documents = payload?.documents ?? [];
      const index = payload?.index
        ? Fuse.parseIndex<SearchDocument>(payload.index as { keys: readonly any[]; records: any[] })
        : undefined;
      return new Fuse(documents, FUSE_OPTIONS, index);
    });
    searchCache.set(basePath, pending);
    return pending;
  };

  return {
    async getFiberContent(slug: string): Promise<FiberContent | null> {
      const basePath = publicationBasePath();
      if (!basePath) return null;
      return fetchJson<FiberContent>(`${basePath}content/${encodeSlugPath(slug)}.json`);
    },

    async getFiberGraph(): Promise<FiberGraph> {
      const basePath = publicationBasePath();
      if (!basePath) return { nodes: [], links: [] };
      return getGraph(basePath);
    },

    async getRawFiber(_slug: string): Promise<RawFiber | null> {
      return null;
    },

    async getAnnotations(_slug: string): Promise<Annotation[]> {
      return [];
    },

    async searchFibers(query: string): Promise<SearchHit[]> {
      const basePath = publicationBasePath();
      if (!basePath || !query.trim()) return [];
      const fuse = await getFuse(basePath);
      return fuse.search(query).slice(0, 24).map(({ item, score }) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        tags: item.tags,
        outcome: item.outcome,
        score: score ?? 0,
      }));
    },

    async getDeltaSince(since: string): Promise<LogResponse> {
      return { since, count: 0, events: [] };
    },

    async getFiberHistory(_slug: string): Promise<HistoryResponse> {
      return { events: [], status: 'ok' };
    },

    async getFile(_path: string): Promise<FileContent | null> {
      return null;
    },
  };
}

export function staticSiteBase(): string {
  return currentSiteBase();
}
