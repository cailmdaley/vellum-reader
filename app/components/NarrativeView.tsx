/**
 * NarrativeView — the main prose column with right-margin citation glyphs.
 *
 * Layout:
 *   [prose column 680px] [gap 56px] [right margin 160px]
 *
 * The prose column renders the fiber body via MyST.
 * The right margin renders citation glyphs positioned at each internal link.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@remix-run/react';
import { MyST } from 'myst-to-react';
import { ArticleProvider } from '@myst-theme/providers';
import { FiberHeader } from './FiberHeader';
import { AstraBlocks } from './AstraBlocks';
import { MarginCitations } from './MarginCitations';
import { TextAnnotationLayer } from './TextAnnotationLayer';
import { Lightbox } from './Lightbox';
import { GhostToc } from './GhostToc';
import { BacklinkNodes } from './BacklinkNodes';
import type { LightboxImage } from './Lightbox';
import type { FiberContent, GraphNode, GraphLink, Annotation } from '~/utils/content-server';

interface NarrativeViewProps {
  content: FiberContent;
  graphNodes: GraphNode[];
  graphLinks?: GraphLink[];
  breadcrumb?: Array<{ label: string; slug: string }>;
  changedIds?: Set<string>;
}

/** Full text content of an mdast node (concatenates all text children). */
function nodeText(node: any): string {
  if (node.value) return node.value;
  if (node.children) {
    return node.children.map((c: any) => nodeText(c)).join('');
  }
  return '';
}

const STATUS_WORDS = new Set([
  'active', 'open', 'closed', 'suspended', 'resolved', 'suspicious', 'blocked',
]);

/**
 * Strip frontmatter-derived nodes from the beginning of the mdast.
 *
 * MySTRA renders status, title, and lede as leading mdast nodes
 * (blockBreak → status paragraph → title heading → lede blockquote).
 * FiberHeader already shows these, so strip them to avoid duplication.
 */
interface StrippedResult {
  mdast: any;
  lede: string | null;
}

function stripFrontmatterNodes(mdast: any, frontmatter: Record<string, any>, graphVerdict?: string): StrippedResult {
  const children = [...(mdast.children ?? [])];
  let i = 0;
  let lede: string | null = null;

  // Skip leading blockBreak nodes
  while (i < children.length && children[i].type === 'blockBreak') i++;

  // Skip status paragraph — either standalone status word ("Active") or
  // combined "**Status** — *outcome text*" format from content server
  if (i < children.length && children[i].type === 'paragraph') {
    const text = nodeText(children[i]).trim().toLowerCase();
    if (STATUS_WORDS.has(text)) {
      i++;
    } else {
      // Check if paragraph starts with a bold status word (e.g. "**Resolved** — ...")
      const firstChild = children[i].children?.[0];
      if (firstChild?.type === 'strong') {
        const boldText = nodeText(firstChild).trim().toLowerCase();
        if (STATUS_WORDS.has(boldText)) i++;
      }
    }
  }

  // Skip title heading (matching frontmatter title, case-insensitive)
  if (i < children.length && children[i].type === 'heading') {
    const text = nodeText(children[i]).trim().toLowerCase();
    const fmTitle = (frontmatter.title ?? '').trim().toLowerCase();
    if (fmTitle && (fmTitle.startsWith(text) || text.startsWith(fmTitle))) i++;
  }

  // Extract lede from blockquote or leading paragraph
  if (i < children.length && children[i].type === 'blockquote') {
    lede = nodeText(children[i]).trim();
    i++;
  } else if (i < children.length && children[i].type === 'paragraph') {
    // Many fibers use the first paragraph as lede (no blockquote wrapper).
    // Strip it if it matches the graph verdict to avoid duplication.
    const paraText = nodeText(children[i]).trim();
    const verdict = (frontmatter.outcome ?? graphVerdict ?? '').trim();
    if (verdict && (paraText.startsWith(verdict) || verdict.startsWith(paraText.slice(0, 80)))) {
      lede = paraText;
      i++;
    }
  }

  return { mdast: { ...mdast, children: children.slice(i) }, lede };
}

export function NarrativeView({ content, graphNodes, graphLinks, breadcrumb, changedIds }: NarrativeViewProps) {
  const proseRef = useRef<HTMLElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [lightboxImages, setLightboxImages] = useState<LightboxImage[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  // Fetch annotations for this fiber
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/annotations?slug=${encodeURIComponent(content.slug)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setAnnotations(data.annotations ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [content.slug]);

  // Find the graph node for this fiber (for status glyph in header)
  const currentNode = graphNodes.find((n) => n.slug === content.slug);

  // Fibers that link TO this fiber (inbound references)
  const backlinkNodes = useMemo(() => {
    if (!currentNode || !graphLinks) return [];
    const nodeById = new Map(graphNodes.map((n) => [n.id, n]));
    return graphLinks
      .filter((l) => l.target === currentNode.id)
      .map((l) => nodeById.get(l.source))
      .filter((n): n is GraphNode => !!n);
  }, [currentNode, graphLinks, graphNodes]);

  // Strip frontmatter duplication from the mdast; extract full lede text
  const { mdast: cleanAst, lede } = useMemo(
    () => stripFrontmatterNodes(content.mdast, content.frontmatter ?? {}, currentNode?.verdict),
    [content.mdast, content.frontmatter, currentNode?.verdict],
  );

  // ── Inline link hover tooltip ──
  // Shows the same fiber tooltip on prose links that margin glyphs show.
  useEffect(() => {
    const prose: HTMLElement | null = proseRef.current;
    const wrapper: HTMLDivElement | null = wrapperRef.current;
    if (!prose || !wrapper) return;
    // Capture non-null refs for closure use
    const _prose = prose;
    const _wrapper = wrapper;

    const nodeBySlug = new Map(graphNodes.map((n) => [n.slug, n]));

    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanups: Array<() => void> = [];
    let tooltip: HTMLDivElement | null = null;

    const STATUS_GLYPHS: Record<string, string> = {
      open: '○', active: '◐', closed: '●', suspended: '·',
      resolved: '●', suspicious: '◈', blocked: '✕',
    };

    function glyphFor(node: GraphNode): string {
      if (node.decisions && node.decisions.length > 0) return '◇';
      return STATUS_GLYPHS[node.status] ?? '○';
    }

    function esc(s: string): string {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showTooltip(node: GraphNode, linkEl: HTMLAnchorElement) {
      if (!tooltip) return;
      const glyph = glyphFor(node);
      const decisionHtml = (node.decisions ?? []).slice(0, 3).map((d) =>
        `<div class="fiber-tooltip__decision"><span class="fiber-tooltip__decision-label">decision</span> ${esc(d.label)}${d.selectedLabel ? `: ${esc(d.selectedLabel)}` : ''}</div>`
      ).join('');
      const moreCount = (node.decisions?.length ?? 0) - 3;
      const moreHtml = moreCount > 0 ? `<div class="fiber-tooltip__decision" style="font-style:italic;color:var(--text-muted)">+${moreCount} more</div>` : '';

      tooltip.innerHTML = `
        <div class="fiber-tooltip__title">${esc(node.label)}</div>
        <div class="fiber-tooltip__status"><span>${glyph}</span><span>${esc(node.status)}</span>${(node.tags ?? []).map(t => `<span class="vellum-tag">${esc(t)}</span>`).join('')}</div>
        ${node.verdict ? `<div class="fiber-tooltip__verdict">${esc(node.verdict)}</div>` : ''}
        ${decisionHtml}${moreHtml}
      `;
      const wrapperRect = _wrapper.getBoundingClientRect();
      const linkRect = linkEl.getBoundingClientRect();
      const top = linkRect.top - wrapperRect.top + _wrapper.scrollTop;
      tooltip.style.display = 'block';
      tooltip.style.top = `${top}px`;
    }

    function attachListeners() {
      // Create tooltip element inside the wrapper
      tooltip = document.createElement('div');
      tooltip.className = 'fiber-tooltip';
      tooltip.style.display = 'none';
      tooltip.setAttribute('aria-hidden', 'true');
      _wrapper.appendChild(tooltip);

      const links = _prose.querySelectorAll<HTMLAnchorElement>('a[href^="/"]');
      for (const link of links) {
        const href = link.getAttribute('href') ?? '';
        const slug = href.replace(/^\//, '').split('#')[0].split('?')[0];
        const node = slug ? nodeBySlug.get(slug) : undefined;
        if (!node) continue;

        const onEnter = () => {
          link.classList.add('margin-active');
          if (hoverTimer) clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => showTooltip(node, link), 250);
        };
        const onLeave = () => {
          link.classList.remove('margin-active');
          if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
          if (tooltip) tooltip.style.display = 'none';
        };

        link.addEventListener('mouseenter', onEnter);
        link.addEventListener('mouseleave', onLeave);
        cleanups.push(() => {
          link.removeEventListener('mouseenter', onEnter);
          link.removeEventListener('mouseleave', onLeave);
        });
      }
    }

    // Delay to let MyST render the prose links into the DOM
    const attachTimer = setTimeout(attachListeners, 120);

    return () => {
      clearTimeout(attachTimer);
      if (hoverTimer) clearTimeout(hoverTimer);
      if (tooltip) { tooltip.remove(); tooltip = null; }
      for (const fn of cleanups) fn();
    };
  }, [content.slug, graphNodes]);

  // SPA navigation for internal links + image lightbox
  const handleProseClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    // Image click → open lightbox
    const img = (e.target as HTMLElement).closest<HTMLImageElement>('img');
    if (img) {
      e.preventDefault();
      // Collect all images in the prose for gallery navigation
      const allImages = Array.from(
        proseRef.current?.querySelectorAll('img') ?? []
      ).map(el => ({
        src: el.src,
        alt: el.alt || '',
        fiberSlug: content.slug,
      }));
      const clickedIndex = allImages.findIndex(i => i.src === img.src);
      setLightboxImages(allImages);
      setLightboxIndex(clickedIndex >= 0 ? clickedIndex : 0);
      return;
    }

    // Internal link click → SPA navigate
    const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/"]');
    if (!anchor) return;
    // Let modified clicks (new tab, etc.) pass through
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(anchor.getAttribute('href')!);
  }, [navigate, content.slug]);

  return (
    <div className="vellum-prose-wrapper" ref={wrapperRef}>
      {/* Prose column */}
      <article className="vellum-prose" ref={proseRef} onClick={handleProseClick}>
        {/* Breadcrumb for nested fibers */}
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="vellum-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">root</Link>
            {breadcrumb.map((crumb) => (
              <span key={crumb.slug} style={{ display: 'contents' }}>
                <span className="vellum-breadcrumb__sep">/</span>
                <Link to={`/${crumb.slug}`}>{crumb.label}</Link>
              </span>
            ))}
          </nav>
        )}

        <FiberHeader
          frontmatter={content.frontmatter ?? {}}
          graphNode={currentNode}
          lede={lede}
        />
        <ArticleProvider
          kind={content.kind as any ?? 'Article'}
          references={content.references ?? { cite: {}, footnotes: {} }}
          frontmatter={content.frontmatter ?? {}}
        >
          <MyST ast={cleanAst} />
        </ArticleProvider>

        <AstraBlocks graphNode={currentNode} />
      </article>

      {/* Right margin — absolutely positioned citation glyphs */}
      <MarginCitations
        nodes={graphNodes}
        proseRef={proseRef}
        wrapperRef={wrapperRef}
        changedIds={changedIds}
      />

      {/* Left gutter — ghost section TOC */}
      <GhostToc proseRef={proseRef} wrapperRef={wrapperRef} />

      {/* Right margin top — inbound backlink nodes, beside the fiber title */}
      <BacklinkNodes nodes={backlinkNodes} navigate={navigate} />

      {/* Left margin — text annotation dots + selection toolbar */}
      <TextAnnotationLayer
        slug={content.slug}
        annotations={annotations}
        proseRef={proseRef}
        wrapperRef={wrapperRef}
        onAnnotationsChange={setAnnotations}
      />

      {/* Lightbox for evidence artifacts / images */}
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
