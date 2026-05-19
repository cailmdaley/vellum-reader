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
 * Resolve a path relative to the site's `_vellum/` shared assets dir.
 *
 * Used for the embed runtime script and tokens stylesheet, which live
 * at `_vellum/embed-runtime.js` and `_vellum/embed-tokens.css` — shared
 * across every publication, so they hang off siteBase rather than the
 * per-publication base. On tapestries that's `/tapestries/_vellum/...`;
 * on a local serve from publication root it's `/_vellum/...`.
 */
function resolveSiteAsset(path: string): string {
  if (!path) return path;
  if (/^([a-z]+:|\/\/|\/)/i.test(path)) return path;
  if (typeof window === 'undefined') return path;
  const siteBase = window.__VELLUM_STATIC__?.siteBase;
  if (!siteBase) return `/${path}`;
  const trimmed = siteBase === '/' ? '' : siteBase.replace(/\/$/, '');
  return `${trimmed}/${path}`;
}

/**
 * Render an HTML companion file in a sandboxed iframe inside a vellum
 * narrative view. After the iframe loads this component injects two
 * shared assets into its contentDocument:
 *
 *   - `_vellum/embed-tokens.css` — palette CSS vars, EB Garamond +
 *     IBM Plex Mono fonts, base body styles. Embeds inherit
 *     vellum-of-a-piece defaults by default; they can override any
 *     of it (redefine tokens, swap fonts, ignore entirely).
 *
 *   - `_vellum/embed-runtime.js` — protocol code that posts the
 *     embed's measured height back to the parent via
 *     `postMessage({ type: 'vellum:height', value })` and toggles an
 *     `.in-iframe` class so embeds can opt into iframe-aware styling
 *     (the runtime also installs an overflow:hidden rule under that
 *     class to suppress redundant scrollbars inside the iframe).
 *
 * Embed authors don't reference either file directly — they just
 * write content. The sandbox attribute permits scripts and same-origin
 * so the runtime works and cross-frame access for injection is allowed,
 * while keeping the iframe insulated from the parent's styles.
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

  // Inject the embed tokens stylesheet and protocol runtime into the
  // iframe's contentDocument on load. The iframe is same-origin
  // (the sandbox includes `allow-same-origin`) so cross-frame access
  // is allowed. Embed authors don't need to <link>/<script> these
  // themselves — they just write content, and the shared defaults +
  // protocol come along for free. Embeds can still override tokens
  // by setting their own CSS variables or properties afterwards.
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    function inject() {
      try {
        const doc = iframe?.contentDocument;
        if (!doc || !doc.head) return;
        if (!doc.querySelector('link[data-vellum-tokens]')) {
          const link = doc.createElement('link');
          link.rel = 'stylesheet';
          link.setAttribute('data-vellum-tokens', '');
          link.href = resolveSiteAsset('_vellum/embed-tokens.css');
          // Insert as the first head child so embed-authored CSS that
          // follows wins via the cascade.
          doc.head.insertBefore(link, doc.head.firstChild);
        }
        if (!doc.querySelector('script[data-vellum-runtime]')) {
          const script = doc.createElement('script');
          script.setAttribute('data-vellum-runtime', '');
          script.src = resolveSiteAsset('_vellum/embed-runtime.js');
          doc.head.appendChild(script);
        }
      } catch {
        // Cross-origin access denied or iframe torn down — embed is on its own.
      }
    }
    iframe.addEventListener('load', inject);
    // Handle the case where the iframe is already loaded by the time the
    // effect runs (React StrictMode double-mount, hot reload, etc.).
    if (iframe.contentDocument?.readyState === 'complete') inject();
    return () => iframe.removeEventListener('load', inject);
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
