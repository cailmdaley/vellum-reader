import { useMemo } from 'react';
import { HtmlEmbed } from './HtmlEmbed';
import { PdfReader } from './FileReader';
import type { FileContent } from '../utils/content-types';

/**
 * Render an arbitrary companion artifact inline in a narrative view.
 *
 * The `artifactEmbed` mdast node is the general form of the older
 * `htmlEmbed` node: one node type, `kind` selects the renderer. The
 * host (portolan's server, or the bake) classifies the file by
 * extension and resolves `src` to a fetchable URL before the node
 * reaches the renderer, so this component is pure dispatch:
 *
 *   - `html`  → HtmlEmbed (sandboxed iframe + height handshake)
 *   - `pdf`   → PdfReader in a fixed-height scrollable viewport with
 *               an "open ↗" escape hatch (a 20-page paper shouldn't
 *               occupy 20 pages of narrative)
 *   - `image` → native <img>
 *   - `audio` → native <audio controls>
 *   - anything else → a plain link to the artifact
 *
 * Unknown kinds degrade to a link rather than an error: the narrative
 * stays readable even when the host classified a file this renderer
 * doesn't know how to inline.
 */

export type ArtifactKind = 'html' | 'pdf' | 'image' | 'audio' | 'markdown' | 'text';

interface ArtifactEmbedProps {
  /** Fetchable URL for the artifact (host-resolved; may be absolute). */
  src: string;
  /** Renderer selector, classified by the host from the file extension. */
  kind?: ArtifactKind | string;
  /** html: initial iframe height. pdf: viewport height (default 70vh). */
  height?: number;
  /** Accessibility label / display name. */
  title?: string;
}

/** Last path segment of the artifact URL, sans query, for display. */
function artifactName(src: string, title?: string): string {
  if (title) return title;
  try {
    const url = new URL(src, 'http://x');
    const segments = url.pathname.split('/').filter(Boolean);
    return decodeURIComponent(segments[segments.length - 1] ?? src);
  } catch {
    return src;
  }
}

const PDF_DEFAULT_HEIGHT = '70vh';

export function ArtifactEmbed({ src, kind, height, title }: ArtifactEmbedProps) {
  const name = artifactName(src, title);
  switch (kind) {
    case 'html':
      return <HtmlEmbed src={src} height={height} title={title} />;
    case 'pdf':
      return <PdfArtifact src={src} height={height} name={name} />;
    case 'image':
      return (
        <img
          src={src}
          alt={name}
          style={{ maxWidth: '100%', display: 'block' }}
        />
      );
    case 'audio':
      return (
        <audio
          controls
          src={src}
          title={name}
          style={{ width: '100%', display: 'block' }}
        />
      );
    default:
      return (
        <p className="vellum-artifact-embed__link">
          <a href={src} target="_blank" rel="noreferrer">
            {name}
          </a>
        </p>
      );
  }
}

/**
 * Inline PDF: fixed-height scrollable viewport over the full document,
 * header bar with the file name and an open-in-new-tab escape hatch.
 * PdfReader pre-creates correctly-sized page wrappers and rasterizes
 * lazily via IntersectionObserver, so nesting it in an overflow:auto
 * container is safe — clipped pages simply don't intersect until
 * scrolled into view.
 */
function PdfArtifact({
  src,
  height,
  name,
}: {
  src: string;
  height?: number;
  name: string;
}) {
  const file = useMemo<FileContent>(
    () => ({ path: name, kind: 'pdf', language: '', content: '', url: src }),
    [src, name],
  );
  return (
    <div className="vellum-artifact-embed vellum-artifact-embed--pdf">
      <div className="vellum-artifact-embed__bar">
        <span className="vellum-artifact-embed__name">{name}</span>
        <a
          className="vellum-artifact-embed__open"
          href={src}
          target="_blank"
          rel="noreferrer"
          title="Open in new tab"
        >
          open ↗
        </a>
      </div>
      <div
        className="vellum-artifact-embed__viewport"
        style={{ height: height ? `${height}px` : PDF_DEFAULT_HEIGHT }}
      >
        <PdfReader file={file} />
      </div>
    </div>
  );
}
