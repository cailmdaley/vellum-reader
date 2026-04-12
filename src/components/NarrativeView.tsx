/**
 * NarrativeView — the main prose column with right-margin citation glyphs.
 *
 * Pretext is the sole narrative renderer. Unknown mdast nodes fall through a
 * compat-island substrate inside PretextProse — pretext reserves a measured
 * height and hands off the subtree to MyST, so tables, details, tabSets,
 * images, and tweet embeds still render correctly.
 *
 * The shell around the prose body: breadcrumb, header, margin citations,
 * annotations, ghost TOC, backlinks, editor, lightbox.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArticleProvider } from '@myst-theme/providers';
import { FiberHeader } from './FiberHeader';
import { AstraBlocks } from './AstraBlocks';
import { MarginCitations } from './MarginCitations';
import { MarginDecisions } from './MarginDecisions';
import { PretextProse } from './PretextProse';
import { TextAnnotationLayer } from './TextAnnotationLayer';
import { Lightbox } from './Lightbox';
import { GhostToc } from './GhostToc';
import { BacklinkNodes } from './BacklinkNodes';
import { ContextCardLayer } from './ContextCardLayer';
import { FiberEditor } from './FiberEditor';
import type { LightboxImage } from './Lightbox';
import type { Annotation, FiberContent, GraphNode, GraphLink } from '~/utils/content-types';
import { getAnnotations, getRawFiber, putRawFiber } from '~/api';
import { transformTweetEmbeds } from '~/utils/tweet-transform';

const MARGIN_LEFT_STORAGE_KEY = 'vellum:margin-left';
const MARGIN_RIGHT_STORAGE_KEY = 'vellum:margin-right';

/**
 * Initial content width used before the real `.vellum-prose` element has
 * been measured. Matches the default desktop column geometry (`--prose-width:
 * 720px` with 3.5rem padding per side at 18px root). The ResizeObserver below
 * takes over immediately once the element mounts.
 */
const INITIAL_CONTENT_WIDTH = 720 - 63 * 2;

/**
 * Minimum margin on either side — keeps the column readable and prevents the
 * handle from being dragged completely off-screen.
 */
const MIN_MARGIN = 24;

/** Default left margin when no drag has occurred — leaves the right margin
 *  free for the thumb index and margin annotations. */
const DEFAULT_MARGIN_LEFT = 48;

function loadMargin(key: string): number {
  if (typeof localStorage === 'undefined') return 0;
  const stored = localStorage.getItem(key);
  if (stored == null) return 0;
  const n = Number(stored);
  return Number.isFinite(n) ? n : 0;
}

interface NarrativeViewProps {
  content: FiberContent;
  graphNodes: GraphNode[];
  graphLinks?: GraphLink[];
  breadcrumb?: Array<{ label: string; slug: string }>;
  changedIds?: Set<string>;
  onEditingChange?: (editing: boolean) => void;
}

function nodeText(node: any): string {
  if (node.value) return node.value;
  if (node.children) return node.children.map((c: any) => nodeText(c)).join('');
  return '';
}

const STATUS_WORDS = new Set([
  'active', 'open', 'closed', 'suspended', 'resolved', 'unresolved', 'blocked',
]);

function stripFrontmatterNodes(mdast: any, frontmatter: Record<string, any>, graphVerdict?: string) {
  const children = [...(mdast.children ?? [])];
  let i = 0;
  let lede: string | null = null;

  while (i < children.length && children[i].type === 'blockBreak') i++;

  if (i < children.length && children[i].type === 'paragraph') {
    const text = nodeText(children[i]).trim().toLowerCase();
    if (STATUS_WORDS.has(text)) {
      i++;
    } else {
      const firstChild = children[i].children?.[0];
      if (firstChild?.type === 'strong') {
        const boldText = nodeText(firstChild).trim().toLowerCase();
        if (STATUS_WORDS.has(boldText)) i++;
      }
    }
  }

  if (i < children.length && children[i].type === 'heading') {
    const text = nodeText(children[i]).trim().toLowerCase();
    const fmTitle = (frontmatter.title ?? '').trim().toLowerCase();
    if (fmTitle && (fmTitle.startsWith(text) || text.startsWith(fmTitle))) i++;
  }

  // Extract lede text for metadata display but do NOT strip it from the
  // prose — the lede is content and should render inline, especially for
  // short-body fibers where it may be the only paragraph.
  if (i < children.length && children[i].type === 'blockquote') {
    lede = nodeText(children[i]).trim();
  } else if (i < children.length && children[i].type === 'paragraph') {
    const paraText = nodeText(children[i]).trim();
    const verdict = (frontmatter.outcome ?? graphVerdict ?? '').trim();
    if (verdict && (paraText.startsWith(verdict) || verdict.startsWith(paraText.slice(0, 80)))) {
      lede = paraText;
    }
  }

  return { mdast: { ...mdast, children: children.slice(i) }, lede };
}

export function NarrativeView({
  content,
  graphNodes,
  graphLinks,
  breadcrumb,
  changedIds,
  onEditingChange,
}: NarrativeViewProps) {
  const proseRef = useRef<HTMLElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [lightboxImages, setLightboxImages] = useState<LightboxImage[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [editorBuffer, setEditorBuffer] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [contentWidth, setContentWidth] = useState<number>(INITIAL_CONTENT_WIDTH);
  const [marginLeft, setMarginLeft] = useState<number>(() => loadMargin(MARGIN_LEFT_STORAGE_KEY));
  const [marginRight, setMarginRight] = useState<number>(() => loadMargin(MARGIN_RIGHT_STORAGE_KEY));

  const currentNode = graphNodes.find((n) => n.slug === content.slug);

  // Push left/right margins onto :root as CSS custom properties so
  // .vellum-page picks them up without any inline style surgery from a child
  // component. When a margin is 0 (default, no drag yet), the CSS fallback
  // in .vellum-page takes over — the old center formula — so first-load
  // users see the same geometry as before. Once either handle is dragged the
  // corresponding --page-margin-* value overrides the fallback and the column
  // stretches to fill the space between the two margins. --prose-width is NOT
  // touched here; it stays at the CSS-declared 720px default so all the
  // marginalia position rules (MarginCitations, MarginDecisions, GhostToc,
  // BacklinkNodes) read a correct anchor. Those components read the actual
  // rendered width via the ResizeObserver below once the column reflows.
  // Set explicit left margin so the prose is left-aligned. Only remove
  // max-width (letting prose stretch) when the user has actively dragged
  // a handle — otherwise the prose stays at its natural --prose-width so
  // the right margin is free for the thumb index and annotations.
  const hasDragged = marginLeft > 0 || marginRight > 0;
  useEffect(() => {
    const root = document.documentElement;
    const left = hasDragged ? Math.max(MIN_MARGIN, marginLeft) : DEFAULT_MARGIN_LEFT;
    root.style.setProperty('--page-margin-left', `${left}px`);
    if (hasDragged) {
      const right = Math.max(MIN_MARGIN, marginRight);
      root.style.setProperty('--page-margin-right', `${right}px`);
      root.style.setProperty('--page-max-width', 'none');
    } else {
      root.style.removeProperty('--page-margin-right');
      root.style.removeProperty('--page-max-width');
    }
    return () => {
      root.style.removeProperty('--page-margin-left');
      root.style.removeProperty('--page-margin-right');
      root.style.removeProperty('--page-max-width');
    };
  }, [marginLeft, marginRight, hasDragged]);

  // Persist both margins. State updates at pointermove frequency; each write
  // is a single setItem of a small string — negligible.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MARGIN_LEFT_STORAGE_KEY, String(marginLeft));
  }, [marginLeft]);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MARGIN_RIGHT_STORAGE_KEY, String(marginRight));
  }, [marginRight]);

  // Drag handler for the left and right resize handles.
  // Left handle: dragging right increases marginLeft (column left edge moves right).
  // Right handle: dragging left increases marginRight (column right edge moves left).
  // Each margin is stored and dragged independently — no center coordinate, no
  // derived widths.
  const handleResizeStart = useCallback(
    (side: 'left' | 'right') => (e: React.PointerEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const startX = e.clientX;
      const startMarginLeft = marginLeft;
      const startMarginRight = marginRight;
      const pointerId = e.pointerId;
      el.setPointerCapture(pointerId);
      e.preventDefault();

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        if (side === 'left') {
          // Dragging right (positive dx) = larger left margin = left edge moves right
          setMarginLeft(Math.max(MIN_MARGIN, startMarginLeft + dx));
        } else {
          // Dragging left (negative dx) = larger right margin = right edge moves left
          setMarginRight(Math.max(MIN_MARGIN, startMarginRight - dx));
        }
      };
      const onEnd = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onEnd);
        el.removeEventListener('pointercancel', onEnd);
        try {
          el.releasePointerCapture(pointerId);
        } catch {
          // pointer already released — safe to ignore
        }
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onEnd);
      el.addEventListener('pointercancel', onEnd);
    },
    [marginLeft, marginRight],
  );

  // Measure `.vellum-prose`'s actual content box so pretext lays into the
  // exact inline size the column renders at — including the responsive CSS
  // breakpoints at 960px and 740px that shrink `--prose-width`. The
  // ResizeObserver's `contentBoxSize` already excludes padding, so no
  // getComputedStyle pass is needed. Shared with PretextProse's internal
  // observer via prop so MarginCitations's outer+inner observer pair still
  // sees width-driven re-layouts.
  useEffect(() => {
    const el = proseRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const boxes = entry.contentBoxSize;
        let inline: number | null = null;
        if (boxes) {
          const box = Array.isArray(boxes) ? boxes[0] : boxes;
          inline = box?.inlineSize ?? null;
        }
        if (inline == null) {
          const rect = entry.contentRect;
          inline = rect?.width ?? null;
        }
        if (inline != null && inline > 0) {
          setContentWidth((prev) => (Math.abs(prev - inline!) < 0.5 ? prev : inline!));
          // Update --prose-width so margin components (citations, backlinks,
          // annotations) position at the actual prose edge, not a hardcoded 720px.
          // borderBoxSize includes padding; contentBoxSize does not. Margin
          // components use `left: calc(var(--prose-width) + gap)` which expects
          // the outer width including padding.
          const borderBoxes = entry.borderBoxSize;
          let outerInline: number | null = null;
          if (borderBoxes) {
            const box = Array.isArray(borderBoxes) ? borderBoxes[0] : borderBoxes;
            outerInline = box?.inlineSize ?? null;
          }
          if (outerInline == null) {
            // fallback: contentWidth + computed padding
            outerInline = inline! + 126; // 63px padding each side
          }
          document.documentElement.style.setProperty('--prose-width', `${outerInline}px`);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
    // Re-observe when the editor unmounts/mounts — the `.vellum-prose` ref
    // points to a different element in each case.
  }, [editorBuffer, editorLoading]);

  useEffect(() => {
    let cancelled = false;
    getAnnotations(content.slug).then((anns) => {
      if (!cancelled) setAnnotations(anns);
    });
    return () => {
      cancelled = true;
    };
  }, [content.slug]);

  const backlinkNodes = useMemo(() => {
    if (!currentNode || !graphLinks) return [];
    const nodeById = new Map(graphNodes.map((n) => [n.id, n]));
    return graphLinks
      .filter((l) => l.target === currentNode.id)
      .map((l) => nodeById.get(l.source))
      .filter((n): n is GraphNode => !!n);
  }, [currentNode, graphLinks, graphNodes]);

  const { mdast: cleanAst, lede } = useMemo(() => {
    const stripped = stripFrontmatterNodes(
      content.mdast,
      content.frontmatter ?? {},
      currentNode?.verdict,
    );
    return { mdast: transformTweetEmbeds(stripped.mdast), lede: stripped.lede };
  }, [content.mdast, content.frontmatter, currentNode?.verdict]);

  useEffect(() => {
    onEditingChange?.(editorBuffer !== null || editorLoading);
  }, [editorBuffer, editorLoading, onEditingChange]);

  useEffect(() => {
    const prose = proseRef.current;
    if (!prose) return;
    if (editorBuffer !== null || editorLoading) return;

    const onDblClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('a')) return;
      if (target.closest('.astra-block, .text-annotation, .vellum-backlink, .fiber-header__meta')) return;
      e.preventDefault();
      window.getSelection()?.removeAllRanges();

      setEditorLoading(true);
      getRawFiber(content.slug)
        .then((raw) => {
          if (raw) setEditorBuffer(raw.body);
        })
        .finally(() => {
          setEditorLoading(false);
        });
    };

    prose.addEventListener('dblclick', onDblClick);
    return () => {
      prose.removeEventListener('dblclick', onDblClick);
    };
  }, [content.slug, editorBuffer, editorLoading]);

  const handleProseClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const img = (e.target as HTMLElement).closest<HTMLImageElement>('img');
    if (img) {
      e.preventDefault();
      const allImages = Array.from(proseRef.current?.querySelectorAll('img') ?? []).map((el) => ({
        src: el.src,
        alt: el.alt || '',
        fiberSlug: content.slug,
      }));
      const clickedIndex = allImages.findIndex((image) => image.src === img.src);
      setLightboxImages(allImages);
      setLightboxIndex(clickedIndex >= 0 ? clickedIndex : 0);
      return;
    }

    const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/"]');
    if (!anchor) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(anchor.getAttribute('href')!);
  }, [navigate]);

  return (
    <div className="vellum-prose-wrapper" ref={wrapperRef}>
      {/* Two drag handles sit on the left/right edges of the prose column.
          They span the full column height so the reader can grab the edge
          anywhere along the page. Pointer capture inside
          handleResizeStart keeps the drag alive through the column
          body. Hidden on ≤960px viewports via CSS — the margin
          substrate collapses there and a resizable column stops making
          sense when there are no margins to trade off against. */}
      <div
        className="vellum-prose-resize vellum-prose-resize--left"
        onPointerDown={handleResizeStart('left')}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize prose column from the left"
      />
      <div
        className="vellum-prose-resize vellum-prose-resize--right"
        onPointerDown={handleResizeStart('right')}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize prose column from the right"
      />
      <article
        className="vellum-prose vellum-prose--pretext"
        ref={proseRef}
        onClick={handleProseClick}
      >
        {editorBuffer === null && (
          <FiberHeader
            frontmatter={content.frontmatter ?? {}}
            graphNode={currentNode}
            lede={lede}
          />
        )}

        {editorBuffer !== null ? (
          <FiberEditor
            initialValue={editorBuffer}
            onSave={(value) => putRawFiber(content.slug, value)}
            onCancel={() => setEditorBuffer(null)}
          />
        ) : (
          <ArticleProvider
            kind={content.kind as any ?? 'Article'}
            references={content.references ?? { cite: {}, footnotes: {} }}
            frontmatter={content.frontmatter ?? {}}
          >
            <PretextProse
              mdast={cleanAst}
              contentWidth={contentWidth}
            />
          </ArticleProvider>
        )}

        {editorBuffer === null && <AstraBlocks graphNode={currentNode} />}
      </article>

      <MarginDecisions
        graphNode={currentNode}
        wrapperRef={wrapperRef}
      />
      <MarginCitations
        nodes={graphNodes}
        proseRef={proseRef}
        wrapperRef={wrapperRef}
        changedIds={changedIds}
      />
      <GhostToc
        proseRef={proseRef}
        wrapperRef={wrapperRef}
      />
      <BacklinkNodes nodes={backlinkNodes} />
      <ContextCardLayer
        graphNodes={graphNodes}
        graphLinks={graphLinks}
        proseRef={proseRef}
        wrapperRef={wrapperRef}
        onNavigate={(slug) => navigate(`/${slug}`)}
      />
      <TextAnnotationLayer
        slug={content.slug}
        annotations={annotations}
        proseRef={proseRef}
        wrapperRef={wrapperRef}
        onAnnotationsChange={setAnnotations}
      />
      {lightboxIndex >= 0 && lightboxImages.length > 0 && (
        <Lightbox
          images={lightboxImages}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(-1)}
          onNavigate={setLightboxIndex}
          graphNodes={graphNodes}
          graphLinks={graphLinks}
          onNavigateToFiber={(slug) => {
            setLightboxIndex(-1);
            navigate(`/${slug}`);
          }}
        />
      )}
    </div>
  );
}
