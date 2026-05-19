import { useEffect, useRef, useState } from 'react';

interface HtmlEmbedProps {
  /**
   * Bundle-relative path emitted by the bake's `rewriteEmbeds` pass
   * (e.g. `embeds/<bundle-slug>/<file>`). Resolved against the
   * static publication's base URL (`window.__VELLUM_STATIC__.publicationBase`)
   * at render time. Absolute URLs, data URIs, and root-relative paths are
   * left untouched.
   */
  src: string;
  /**
   * Initial iframe height in pixels before the embedded page posts its
   * measured height back via `postMessage({ type: 'vellum:height', value })`.
   * Defaults to 400.
   */
  height?: number;
  /** Accessibility label for the iframe. */
  title?: string;
  /** Optional marker for debug attribution; ignored by the renderer. */
  error?: string;
}

declare global {
  interface Window {
    __VELLUM_STATIC__?: {
      siteBase?: string;
      publicationBase?: string;
    };
  }
}

/**
 * Resolve an embed `src` against the active publication base.
 *
 * Static publications populate `window.__VELLUM_STATIC__.publicationBase`
 * with the URL prefix the SPA was loaded from (e.g. `/tapestries/<slug>/`).
 * The bake emits embed `src` as `embeds/<bundle-slug>/<file>` — relative
 * to that base — so the iframe needs the base prepended to find the
 * actual file regardless of which descendant page is currently mounted.
 *
 * Non-static contexts (canvas dev mode, file reader, etc.) leave the
 * src as-is; in those mounts there's no static deploy to prepend, and
 * unresolved embeds simply don't render — that's a known and acceptable
 * degradation for now.
 */
function resolveEmbedSrc(src: string): string {
  if (!src) return src;
  if (/^([a-z]+:|\/\/|\/)/i.test(src)) return src; // absolute, protocol-relative, root-relative
  if (typeof window === 'undefined') return src;
  const base = window.__VELLUM_STATIC__?.publicationBase;
  if (!base) return src;
  const trimmed = base.endsWith('/') ? base : `${base}/`;
  return `${trimmed}${src}`;
}

/**
 * Render an HTML companion file in a sandboxed iframe inside a vellum
 * narrative view. The embedded page communicates its measured height
 * back via `postMessage({ type: 'vellum:height', value: <px> })` from
 * its content window; the iframe's height resizes to match so the
 * surrounding prose layout stays correct.
 *
 * Embedded pages opt into the height handshake by adding:
 *
 *   <script>
 *     const post = () => parent.postMessage({
 *       type: 'vellum:height',
 *       value: document.documentElement.scrollHeight
 *     }, '*');
 *     window.addEventListener('load', post);
 *     new ResizeObserver(post).observe(document.documentElement);
 *   </script>
 *
 * Without the handshake the iframe falls back to its `height` prop (or
 * 400px). The sandbox attribute permits scripts and same-origin so
 * postMessage and any client-side interactivity inside the embed work,
 * while keeping the iframe insulated from the parent page's styles.
 */
export function HtmlEmbed({ src, height: initialHeight, title }: HtmlEmbedProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>(initialHeight ?? 400);
  const resolved = resolveEmbedSrc(src);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const payload = event.data;
      if (!payload || typeof payload !== 'object') return;
      if ((payload as { type?: unknown }).type !== 'vellum:height') return;
      const raw = (payload as { value?: unknown }).value;
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(value) && value > 0) {
        setHeight((current) => (Math.abs(current - value) > 1 ? Math.ceil(value) : current));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!resolved) {
    return (
      <div className="vellum-html-embed vellum-html-embed--missing" role="note">
        <em>Embed source missing.</em>
      </div>
    );
  }

  return (
    <iframe
      ref={ref}
      src={resolved}
      title={title ?? 'Embedded HTML companion'}
      sandbox="allow-scripts allow-same-origin allow-popups"
      style={{
        display: 'block',
        width: '100%',
        height: `${height}px`,
        border: '1px solid var(--rule, #C5B89E)',
        borderRadius: 2,
        background: 'var(--rag, #FBF6E9)',
      }}
    />
  );
}
