/**
 * Lightcone's Adapter implementation.
 *
 * Speaks to the lightcone backend over HTTP. Other hosts (portolan main app,
 * portolan static viewer) provide their own adapter factories. Vellum
 * components consume whichever adapter the host injects via AdapterProvider.
 */

import type {
  Annotation,
  AstraGraph,
  FiberContent,
  FileContent,
  HistoryEvent,
  HistoryResponse,
  LogResponse,
  RawFiber,
  SearchHit,
} from './utils/content-types';
import type {
  Adapter,
  CreateAnnotationInput,
  FrontmatterPatch,
  GetAnnotationsOptions,
} from './adapter';

function encodeSlug(slug: string): string {
  return slug.split('/').map(encodeURIComponent).join('%2F');
}

export function createLightconeAdapter(): Adapter {
  return {
    async getFiberContent(slug: string): Promise<FiberContent | null> {
      const res = await fetch(`/content/${encodeSlug(slug)}.json`).catch(() => null);
      if (!res || res.status === 404 || !res.ok) return null;
      return res.json() as Promise<FiberContent>;
    },

    async getAstraGraph(): Promise<AstraGraph> {
      const res = await fetch('/astra-graph.json').catch(() => null);
      if (!res || res.status === 404 || !res.ok) return { nodes: [], links: [] };
      return res.json() as Promise<AstraGraph>;
    },

    async searchFibers(query: string): Promise<SearchHit[]> {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`).catch(() => null);
      if (!res || !res.ok) return [];
      const data = await res.json();
      return (data.hits ?? []) as SearchHit[];
    },

    async getDeltaSince(since: string, limit = 200): Promise<LogResponse> {
      const params = new URLSearchParams({ since, limit: String(limit) });
      const res = await fetch(`/api/log?${params}`).catch(() => null);
      if (!res || !res.ok) return { since, count: 0, events: [] };
      return res.json() as Promise<LogResponse>;
    },

    async getFiberHistory(slug: string): Promise<HistoryEvent[]> {
      // Multi-segment slugs (`vellum-reader/history-card`) ride through
      // the `/api/history/*` catch-all without per-segment encoding —
      // mystra's express route resolves the full path via `req.params[0]`.
      // We percent-encode segments anyway to defend against unusual
      // characters in transitional fiber ids.
      const res = await fetch(`/api/history/${encodeSlug(slug)}`).catch(() => null);
      if (!res || res.status === 404 || !res.ok) return [];
      const data = (await res.json().catch(() => null)) as HistoryResponse | null;
      return data?.events ?? [];
    },

    async getAnnotations(slug: string, opts: GetAnnotationsOptions = {}): Promise<Annotation[]> {
      const params = new URLSearchParams({ slug });
      if (opts.kind) params.set('kind', opts.kind);
      if (opts.imageSrc) params.set('imageSrc', opts.imageSrc);
      const res = await fetch(`/api/annotations?${params}`).catch(() => null);
      if (!res || !res.ok) return [];
      const data = await res.json();
      return (data.annotations ?? []) as Annotation[];
    },

    async getRawFiber(slug: string): Promise<RawFiber | null> {
      const res = await fetch(`/content/${encodeSlug(slug)}.md`).catch(() => null);
      if (!res || !res.ok) return null;
      return res.json() as Promise<RawFiber>;
    },

    async getFile(_path: string): Promise<FileContent | null> {
      // Lightcone serves fibers, not arbitrary project files. Portolan adapters
      // implement this against /project-file/ and /raw-file/.
      return null;
    },

    async createAnnotation(input: CreateAnnotationInput): Promise<Annotation | null> {
      const res = await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }).catch(() => null);
      if (!res || !res.ok) return null;
      const data = await res.json();
      return (data.annotation ?? null) as Annotation | null;
    },

    async updateAnnotation(id: string, comment: string): Promise<Annotation | null> {
      const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      }).catch(() => null);
      if (!res || !res.ok) return null;
      const data = await res.json();
      return (data.annotation ?? null) as Annotation | null;
    },

    async deleteAnnotation(id: string): Promise<boolean> {
      const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => null);
      return !!res?.ok;
    },

    async patchFiberFrontmatter(slug: string, patch: FrontmatterPatch): Promise<void> {
      const res = await fetch(`/content/${encodeSlug(slug)}.md`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontmatter: patch }),
      }).catch(() => null);

      if (!res || !res.ok) {
        const err = await res?.json().catch(() => ({})) as { error?: string } | undefined;
        throw new Error(err?.error ?? `patch failed${res ? ` (${res.status})` : ''}`);
      }
    },

    async saveFile(): Promise<void> {
      // Lightcone serves read-only fiber content, not editable project files.
      throw new Error('saveFile: lightcone adapter is read-only for project files');
    },

    async putRawFiber(slug: string, body: string): Promise<void> {
      const res = await fetch(`/content/${encodeSlug(slug)}.md`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      }).catch(() => null);

      if (!res || !res.ok) {
        const err = await res?.json().catch(() => ({})) as { error?: string } | undefined;
        throw new Error(err?.error ?? `save failed${res ? ` (${res.status})` : ''}`);
      }
    },
  };
}
