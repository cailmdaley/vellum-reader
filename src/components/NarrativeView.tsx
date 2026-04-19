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
import { AstraAppendix } from './AstraAppendix';
import { AstraLegend } from './AstraLegend';
import { MarginCitations } from './MarginCitations';
import { PretextProse } from './PretextProse';
import { collectAstraAnchorKinds } from '~/utils/astra-anchor';
import { TextAnnotationLayer } from './TextAnnotationLayer';
import { Lightbox } from './Lightbox';
import { GhostToc } from './GhostToc';
import { BacklinkNodes } from './BacklinkNodes';
import { FiberEditor } from './FiberEditor';
import type { LightboxImage } from './Lightbox';
import type { Annotation, FiberContent, GraphNode, GraphLink } from '~/utils/content-types';
import { useAdapter } from '~/contexts/AdapterContext';
import { transformTweetEmbeds } from '~/utils/tweet-transform';

/**
 * Initial content width used before the real `.vellum-prose` element has
 * been measured. Matches the default desktop column geometry (`--prose-width:
 * 720px` with 3.5rem padding per side at 18px root). The ResizeObserver below
 * takes over immediately once the element mounts.
 */
const INITIAL_CONTENT_WIDTH = 720 - 63 * 2;

/** Default left margin when no drag has occurred — leaves the right margin
 *  free for the thumb index and margin annotations. */
const DEFAULT_MARGIN_LEFT = 48;

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
  breadcrumb: _breadcrumb,
  changedIds,
  onEditingChange,
}: NarrativeViewProps) {
  const proseRef = useRef<HTMLElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const adapter = useAdapter();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [lightboxImages, setLightboxImages] = useState<LightboxImage[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [editorBuffer, setEditorBuffer] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [contentWidth, setContentWidth] = useState<number>(INITIAL_CONTENT_WIDTH);

  const currentNode = graphNodes.find((n) => n.slug === content.slug);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--page-margin-left', `${DEFAULT_MARGIN_LEFT}px`);
    root.style.removeProperty('--page-margin-right');
    root.style.removeProperty('--page-max-width');
    return () => {
      root.style.removeProperty('--page-margin-left');
      root.style.removeProperty('--page-margin-right');
      root.style.removeProperty('--page-max-width');
    };
  }, []);

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
    // Fetch every annotation in the project, not just those keyed to
    // this slug. Annotations are anchored to the *text*; the layer's
    // findAnnotationInDom decides which ones match the current prose
    // by selectedText + surrounding context. This way a note travels
    // wherever its passage appears (a quote that lives on two pages
    // shows up on both) and the slug field is just a record of where
    // the note was first written.
    setAnnotations([]);
    let cancelled = false;
    adapter.getAnnotations('').then((anns) => {
      if (!cancelled) setAnnotations(anns);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, content.slug]);

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

  // Kinds of ASTRA anchor refs that actually appear in the prose. The
  // legend renders only these (empty set → component returns null), so
  // ordinary felt fibers stay free of the legend chip strip.
  const anchorKinds = useMemo(
    () => collectAstraAnchorKinds(cleanAst),
    [cleanAst],
  );

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
      adapter.getRawFiber(content.slug)
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
  }, [adapter, content.slug, editorBuffer, editorLoading]);

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
    const slug = anchor.getAttribute('href')!.replace(/^\//, '');
    const node = graphNodes.find((candidate) => candidate.slug === slug);
    if (!node) {
      navigate(anchor.getAttribute('href')!);
      return;
    }

    const rawCanvasWidth = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--canvas-width'),
    );
    const canvasWidth = Number.isFinite(rawCanvasWidth) && rawCanvasWidth > 0 ? rawCanvasWidth : 360;
    const rect = anchor.getBoundingClientRect();
    document.dispatchEvent(
      new CustomEvent('vellum:open-card', {
        detail: {
          content: { type: 'fiber', node },
          x: window.innerWidth - canvasWidth + 16,
          y: rect.top,
        },
      }),
    );
  }, [graphNodes, navigate]);

  return (
    <div className="vellum-prose-wrapper" ref={wrapperRef}>
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
            onSave={(value) => adapter.putRawFiber(content.slug, value)}
            onCancel={() => setEditorBuffer(null)}
          />
        ) : (
          <ArticleProvider
            kind={content.kind as any ?? 'Article'}
            references={content.references ?? { cite: {}, footnotes: {} }}
            frontmatter={content.frontmatter ?? {}}
          >
            <AstraLegend kinds={anchorKinds} />
            <PretextProse
              mdast={cleanAst}
              contentWidth={contentWidth}
            />
          </ArticleProvider>
        )}

        {editorBuffer === null && (
          <AstraAppendix node={currentNode} width={contentWidth} />
        )}
      </article>

      <MarginCitations
        nodes={graphNodes}
        proseRef={proseRef}
        wrapperRef={wrapperRef}
        changedIds={changedIds}
        currentNode={currentNode}
      />
      <GhostToc
        proseRef={proseRef}
        wrapperRef={wrapperRef}
      />
      <BacklinkNodes nodes={backlinkNodes} />
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
