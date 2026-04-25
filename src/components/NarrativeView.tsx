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
import { ThemePicker } from './ThemePicker';
import { FindingsProvider } from '~/contexts/FindingsContext';
import { MarginFindingsStepper } from './MarginFindingsStepper';
import { AuthoringLintStrip } from './AuthoringLintStrip';
import { AstraAppendix } from './AstraAppendix';
import { FigureGallery } from './FigureGallery';
import { MarginCitations } from './MarginCitations';
import { NarrativeCounter } from './NarrativeCounter';
import { GutterHoverCard } from './GutterHoverCard';
import { PretextProse } from './PretextProse';
import { TextAnnotationLayer } from './TextAnnotationLayer';
import { NarrativeAnnotationActionsBar } from './NarrativeAnnotationActionsBar';
import { Lightbox } from './Lightbox';
import { GhostToc } from './GhostToc';
import { LeftRailToc } from './LeftRailToc';
import { BacklinkNodes } from './BacklinkNodes';
import { FiberEditor } from './FiberEditor';
import type { LightboxImage } from './Lightbox';
import type { Annotation, FiberContent, GraphNode, GraphLink } from '~/utils/content-types';
import { useAdapter } from '~/contexts/AdapterContext';
import { useAnnotationActions } from '~/contexts/AnnotationActionsContext';
import { useTheme } from '~/contexts/ThemeContext';
import { transformTweetEmbeds } from '~/utils/tweet-transform';
import { parseAstraAnchor } from '~/utils/astra-anchor';

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

/**
 * Walk the full graph to locate a node that hosts an ASTRA ref. Used as a
 * last-ditch resolver before we give up on a click: if the user clicked
 * `#findings.foo` but `foo` lives on another analysis, navigate there with
 * the hash so that analysis's AstraAppendix auto-expands the row on mount.
 *
 * Without this fallback every "off-page" ref silently no-ops, which was
 * the named gap in the themes-constitution Pass 9a checklist. Decisions
 * and findings are keyed by `.key`; inputs and outputs by `.id` — mirroring
 * the local-lookup shape in handleProseClick.
 */
function findHostForAstraRef(
  graphNodes: GraphNode[],
  kind: 'decisions' | 'findings' | 'outputs' | 'inputs',
  id: string,
): GraphNode | undefined {
  for (const node of graphNodes) {
    if (kind === 'decisions') {
      if (node.decisions?.some((d) => d.key === id)) return node;
    } else if (kind === 'findings') {
      if (node.findings?.some((f) => f.key === id)) return node;
    } else if (kind === 'outputs') {
      if (node.outputs?.some((o) => o.id === id)) return node;
    } else if (kind === 'inputs') {
      if (node.inputs?.some((i) => i.id === id)) return node;
    }
  }
  return undefined;
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
    // Match against `name` *or* `title` — mystra serves frontmatter with
    // `name` renamed to `title`, so reading only `.name` here missed
    // every fiber whose body opened with a heading that duplicated its
    // title (e.g. /desi-bao). FiberHeader has been falling back to
    // `.title` since forever; without the same fallback here, the
    // demoteHeadingsIfBodyHasH1 pass downstream picks up the duplicate
    // as a "legitimate" body heading and demotes it to h2 instead of
    // dropping it — leaving the page with two side-by-side identical
    // headings (h1 masthead + h2 body) and the duplicate heading
    // announced twice by AT.
    const fmName = (frontmatter.name ?? frontmatter.title ?? '')
      .trim()
      .toLowerCase();
    if (fmName && (fmName.startsWith(text) || text.startsWith(fmName))) i++;
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

/**
 * Demote every heading by one depth-level (capped at depth 6) when the
 * body still carries a depth-1 heading after frontmatter stripping. The
 * canonical document `<h1>` is the FiberHeader masthead; any surviving
 * body h1 produces two h1s on the page, which breaks the canonical
 * single-h1 a11y pattern (screen-reader heading-jump can't tell which
 * is the real title).
 *
 * The strip-frontmatter pass already drops a leading body h1 when its
 * text matches the frontmatter name — so this demotion runs only on
 * fibers whose first body heading is *not* a duplicate title (i.e. a
 * legitimate body heading that happens to be h1). Demoting all
 * headings by one keeps relative hierarchy and makes FiberHeader the
 * sole h1 on the page.
 *
 * No-op when the body has no h1 — the common case.
 */
function demoteHeadingsIfBodyHasH1(mdast: any): any {
  if (!mdast || !Array.isArray(mdast.children)) return mdast;
  const hasH1 = mdast.children.some(
    (c: any) => c?.type === 'heading' && c.depth === 1,
  );
  if (!hasH1) return mdast;
  const demoted = mdast.children.map((c: any) => {
    if (c?.type !== 'heading') return c;
    const depth = typeof c.depth === 'number' ? c.depth : 1;
    return { ...c, depth: Math.min(6, depth + 1) };
  });
  return { ...mdast, children: demoted };
}

/**
 * Inject a sentinel mdast node — `{ type: 'astraFindingsStepper' }` —
 * at the end of the findings narrative section, so PretextProse renders
 * the stepper inline right after the findings prose. Safe to call with
 * no findings heading or no findings; returns the tree unchanged.
 *
 * The section ends at the next heading of depth ≤ 2 or the end of the
 * children list; the sentinel goes in just before that boundary so it
 * sits within the findings section, not under "Methods".
 */
function injectFindingsStepper(mdast: any, findingsCount: number): any {
  if (!mdast || findingsCount <= 0) return mdast;
  const children: any[] = Array.isArray(mdast.children) ? [...mdast.children] : [];
  const headingIdx = children.findIndex(
    (c) =>
      c?.type === 'heading' &&
      (c.identifier === 'findings' || c.label === 'findings'),
  );
  if (headingIdx < 0) return mdast;
  // Walk forward to the next depth-≤2 heading, or the end.
  let end = headingIdx + 1;
  while (end < children.length) {
    const c = children[end];
    if (c?.type === 'heading' && (c.depth ?? 99) <= 2) break;
    end++;
  }
  const sentinel = { type: 'astraFindingsStepper' };
  children.splice(end, 0, sentinel);
  return { ...mdast, children };
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
  const { theme, themeId } = useTheme();
  // Two-axis decision: (a) does the MarginCitations chip rail mount,
  // (b) does the persistent Cail chrome (NarrativeCounter etc.) mount.
  // `persistent` turns both on; Pass-9b `compact-chips` turns only the
  // rail on (lightcone-margin doesn't want the power-user chrome on top).
  const showMarginColumn =
    theme.layout.marginColumn === 'persistent' ||
    theme.layout.marginColumn === 'compact-chips';
  const showNarrativeCounter = theme.layout.marginColumn === 'persistent';
  const showLeftRailToc = theme.layout.leftRailToc === 'on';
  // GhostToc and LeftRailToc are alternate takes on "left-margin section
  // navigation"; mounting both doubles up. The rail is the strict superset
  // (scroll-spy + nested appendix children), so when it's on we retire ghost.
  const showGhostToc = !showLeftRailToc;
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // Bumped by NarrativeAnnotationActionsBar after a bulk action mutates
  // the annotation set, so the fetch effect re-reads from the adapter
  // without forcing a full route remount.
  const [annotationRefreshKey, setAnnotationRefreshKey] = useState(0);
  const refreshAnnotations = useCallback(() => {
    setAnnotationRefreshKey((n) => n + 1);
  }, []);
  const { bulkActions: annotationBulkActions } = useAnnotationActions();
  const [lightboxImages, setLightboxImages] = useState<LightboxImage[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  // External surfaces (e.g. the finding-card evidence thumbnail) request the
  // lightbox by dispatching a custom event — avoids prop-drilling the open
  // callback into every child that might want to zoom a figure.
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ images: LightboxImage[]; index?: number }>;
      if (!ev.detail?.images?.length) return;
      setLightboxImages(ev.detail.images);
      setLightboxIndex(ev.detail.index ?? 0);
    };
    document.addEventListener('vellum:open-lightbox', handler);
    return () => document.removeEventListener('vellum:open-lightbox', handler);
  }, []);
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
  }, [adapter, content.slug, annotationRefreshKey]);

  const backlinkNodes = useMemo(() => {
    if (!currentNode || !graphLinks) return [];
    const nodeById = new Map(graphNodes.map((n) => [n.id, n]));
    return graphLinks
      .filter((l) => l.target === currentNode.id)
      .map((l) => nodeById.get(l.source))
      .filter((n): n is GraphNode => !!n);
  }, [currentNode, graphLinks, graphNodes]);

  /**
   * Child sub-analyses reachable from the current node via `contains` edges,
   * indexed by the final path segment (the key `#analyses.<key>` refers to).
   * The astra-project graph builder emits one `contains` link per nested
   * `analyses.<key>`. `childSubKeys` (the set of keys) and
   * `subAnalysisLabels` (key → display label) feed margin-glyph resolution
   * and label rendering respectively. Undefined when graphLinks is absent,
   * so the resolver falls back to its legacy "lookup pending" state.
   *
   * `parentSub*` mirror this for the parent of the current sub-analysis —
   * the `../analyses.<key>` parent-scope escape resolves against these. From
   * inside `desi-bao/analyses/measurements`, the parent is `desi-bao` and the
   * parent's children are `measurements`, `reconstruction`, `bao_fitting`;
   * `../analyses.reconstruction` resolves to a sibling sub-analysis page.
   * `parentSubSlugs` keeps the full slug per key so the click handler can
   * navigate without rebuilding it from path parts.
   */
  const { childSubKeys, subAnalysisLabels, childSubSlugs, parentSubKeys, parentSubLabels, parentSubSlugs, parentNode } = useMemo(() => {
    if (!currentNode || !graphLinks) {
      return {
        childSubKeys: undefined,
        subAnalysisLabels: undefined,
        childSubSlugs: undefined,
        parentSubKeys: undefined,
        parentSubLabels: undefined,
        parentSubSlugs: undefined,
        parentNode: undefined,
      };
    }
    const nodeById = new Map(graphNodes.map((n) => [n.id, n]));
    const keys = new Set<string>();
    const labels = new Map<string, string>();
    const cSlugs = new Map<string, string>();
    for (const link of graphLinks) {
      if (link.kind !== 'contains') continue;
      if (link.source !== currentNode.id) continue;
      const key = link.target.split('/').pop();
      if (!key) continue;
      keys.add(key);
      const child = nodeById.get(link.target);
      if (child?.label) labels.set(key, child.label);
      if (child?.slug) cSlugs.set(key, child.slug);
    }

    // Parent-scope: find the incoming `contains` edge whose target is this
    // node, then enumerate the parent's other children. One inbound contains
    // is the canonical case; multi-parent isn't a structure the graph
    // produces today, so first hit wins.
    const inbound = graphLinks.find(
      (l) => l.kind === 'contains' && l.target === currentNode.id,
    );
    if (!inbound) {
      return {
        childSubKeys: keys,
        subAnalysisLabels: labels,
        childSubSlugs: cSlugs,
        parentSubKeys: undefined,
        parentSubLabels: undefined,
        parentSubSlugs: undefined,
        parentNode: undefined,
      };
    }
    const parent = nodeById.get(inbound.source);
    const pKeys = new Set<string>();
    const pLabels = new Map<string, string>();
    const pSlugs = new Map<string, string>();
    for (const link of graphLinks) {
      if (link.kind !== 'contains') continue;
      if (link.source !== inbound.source) continue;
      if (link.target === currentNode.id) continue; // skip self
      const key = link.target.split('/').pop();
      if (!key) continue;
      pKeys.add(key);
      const sib = nodeById.get(link.target);
      if (sib?.label) pLabels.set(key, sib.label);
      if (sib?.slug) pSlugs.set(key, sib.slug);
    }
    return {
      childSubKeys: keys,
      subAnalysisLabels: labels,
      childSubSlugs: cSlugs,
      parentSubKeys: pKeys,
      parentSubLabels: pLabels,
      parentSubSlugs: pSlugs,
      parentNode: parent,
    };
  }, [currentNode, graphLinks, graphNodes]);

  const { mdast: cleanAst, lede } = useMemo(() => {
    const stripped = stripFrontmatterNodes(
      content.mdast,
      content.frontmatter ?? {},
      currentNode?.verdict,
    );
    // After stripping a duplicate-title h1, any surviving body h1 means
    // the author wrote a legitimate body h1 that wasn't the title — keep
    // the FiberHeader as sole page h1 by demoting body headings.
    const demoted = demoteHeadingsIfBodyHasH1(stripped.mdast);
    const firstClassFindings = (currentNode?.findings ?? []).filter(
      (f) => f.kind !== 'prior_insight',
    );
    // Inline stepper only in themes without a margin column. Margin themes
    // render the stepper as an absolute-positioned card anchored to the
    // findings heading (MarginFindingsStepper, below in the render).
    const shouldInjectInline =
      !showMarginColumn && firstClassFindings.length > 0;
    const withStepper = shouldInjectInline
      ? injectFindingsStepper(demoted, firstClassFindings.length)
      : demoted;
    return { mdast: transformTweetEmbeds(withStepper), lede: stripped.lede };
  }, [
    content.mdast,
    content.frontmatter,
    currentNode?.verdict,
    currentNode?.findings,
    showMarginColumn,
  ]);

  // Outgoing cites from this fiber — counted for the marginalia counter
  // ("N refs" row). The graph builder emits one cites edge per
  // `[[wikilink]]` that resolves to a real fiber; external-URL or dead
  // wikilinks stay out.
  const refCount = useMemo(() => {
    if (!currentNode || !graphLinks) return 0;
    return graphLinks.filter(
      (l) => l.kind === 'cites' && l.source === currentNode.id,
    ).length;
  }, [currentNode, graphLinks]);

  // Sub-analysis count — `contains` edges whose source is this node.
  // Matches how FloatingIsland derives `allChildNodes` for the thumb-index.
  const analysisCount = useMemo(() => {
    if (!currentNode || !graphLinks) return 0;
    return graphLinks.filter(
      (l) => l.kind === 'contains' && l.source === currentNode.id,
    ).length;
  }, [currentNode, graphLinks]);

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

    // MarginCitations owns the click→pin path for fiber + ASTRA anchors: its
    // native click listener (attached during the measure pass) dispatches the
    // same `vellum:open-card` event the hover-card's pin button uses, so both
    // hover and click land the same card in the same spot. If that listener
    // fired, it already called stopPropagation and this React handler never
    // runs for the anchor — we just guard against the edge case where the
    // listener hasn't attached yet (prose hasn't measured), in which case
    // falling through to the legacy dispatch below keeps the link clickable.
    const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (!anchor) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = anchor.getAttribute('href') ?? '';
    if (!href) return;

    const rawCanvasWidth = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--canvas-width'),
    );
    const canvasWidth = Number.isFinite(rawCanvasWidth) && rawCanvasWidth > 0 ? rawCanvasWidth : 360;
    const rect = anchor.getBoundingClientRect();
    const openCard = (cardContent: any) => {
      document.dispatchEvent(
        new CustomEvent('vellum:open-card', {
          detail: {
            content: cardContent,
            x: window.innerWidth - canvasWidth + 16,
            y: rect.top,
          },
        }),
      );
    };

    // ASTRA anchors — `#findings.id`, `#decisions.id`, `#outputs.id`,
    // `#inputs.id`, `#analyses.sub`, `#decisions.id.options.optid`. The
    // margin glyph column already signals broken anchors visually; here
    // we simply no-op on them instead of navigating to a meaningless
    // hash that would scroll the page out of the reader.
    if (href.startsWith('#') || href.startsWith('../')) {
      const parsed = parseAstraAnchor(href);
      if (!parsed) return; // plain heading anchor — let the default fire
      e.preventDefault();
      if (!currentNode) return;
      // Under lightcone-linear the appendix collapses into an exclusive-open
      // tray; prose ref clicks drive that tray rather than opening a float
      // card. Dispatch first; AstraAppendix expands the matching row and
      // scrolls it into view. Inputs have no tray entry — fall through to
      // the float-card path so the reader still has a surface.
      if (themeId === 'lightcone-linear' && !parsed.parentEscapes) {
        if (
          parsed.kind === 'findings' ||
          parsed.kind === 'decisions' ||
          parsed.kind === 'outputs' ||
          parsed.kind === 'inputs'
        ) {
          document.dispatchEvent(
            new CustomEvent('vellum:expand-appendix-row', {
              detail: {
                kind:
                  parsed.kind === 'findings'
                    ? 'finding'
                    : parsed.kind === 'decisions'
                      ? 'decision'
                      : parsed.kind === 'outputs'
                        ? 'output'
                        : 'input',
                id: parsed.id,
              },
            }),
          );
          return;
        }
      }
      // Parent-escape refs (`../findings.id`, `../decisions.id`, `../outputs.id`,
      // `../inputs.id`) resolve against the parent node and navigate there,
      // carrying a hash so the parent's AstraAppendix can auto-expand the
      // targeted row after load. If the ref doesn't exist on the parent,
      // fall through to the graph-walk fallback below — the author may have
      // written `../` loosely when the true host is a sibling or cousin.
      if (parsed.parentEscapes === 1 && parentNode && parsed.kind !== 'analyses') {
        const host = parentNode;
        const found =
          parsed.kind === 'decisions'
            ? host.decisions?.find((d) => d.key === parsed.id)
            : parsed.kind === 'findings'
              ? host.findings?.find((f) => f.key === parsed.id)
              : parsed.kind === 'outputs'
                ? host.outputs?.find((o) => o.id === parsed.id)
                : parsed.kind === 'inputs'
                  ? host.inputs?.find((i) => i.id === parsed.id)
                  : null;
        if (found) {
          navigate(`/${host.slug}#${parsed.kind}.${parsed.id}`);
          return;
        }
        // fall through to graph-walk fallback
      }
      // Graph-walk fallback for any non-analyses ASTRA ref that doesn't
      // resolve against `currentNode` (or `parentNode` for `../`): search
      // the full graph for a node hosting `kind.id` and navigate there
      // with the hash. `AstraAppendix` auto-expands the row on mount from
      // the hash, so the landing state mirrors a local tray click. This
      // closes the "off-page refs silently no-op" gap named in the Pass
      // 9a checklist without requiring a broken-ref modal for the common
      // case — modals are reserved for refs that truly don't exist anywhere.
      const offPageNavigate = (
        kind: 'decisions' | 'findings' | 'outputs' | 'inputs',
      ): boolean => {
        const host = findHostForAstraRef(graphNodes, kind, parsed.id);
        if (!host || host.slug === currentNode.slug) return false;
        navigate(`/${host.slug}#${kind}.${parsed.id}`);
        return true;
      };

      switch (parsed.kind) {
        case 'decisions': {
          const decision = currentNode.decisions?.find((d) => d.key === parsed.id);
          if (decision) {
            openCard({ type: 'decision', decision, hostSlug: currentNode.slug });
            return;
          }
          if (offPageNavigate('decisions')) return;
          return;
        }
        case 'findings': {
          const finding = currentNode.findings?.find((f) => f.key === parsed.id);
          if (finding) {
            openCard({ type: 'finding', finding, hostSlug: currentNode.slug, hostNode: currentNode });
            return;
          }
          if (offPageNavigate('findings')) return;
          return;
        }
        case 'outputs': {
          const out = currentNode.outputs?.find((o) => o.id === parsed.id);
          if (out) {
            openCard({ type: 'output', output: out, hostNode: currentNode });
            return;
          }
          if (offPageNavigate('outputs')) return;
          return;
        }
        case 'inputs': {
          const inp = currentNode.inputs?.find((i) => i.id === parsed.id);
          if (inp) {
            openCard({ type: 'input', input: inp, hostNode: currentNode });
            return;
          }
          if (offPageNavigate('inputs')) return;
          return;
        }
        case 'analyses': {
          // Sub-analysis anchor. `#analyses.<key>` walks down to a child;
          // `../analyses.<key>` escapes one level up and resolves against a
          // sibling. The graphLinks-backed `parentSubSlugs` map carries the
          // sibling's full slug so we don't reconstruct it from path parts.
          if (parsed.parentEscapes > 0) {
            const sibSlug = parentSubSlugs?.get(parsed.id);
            if (!sibSlug) return;
            navigate(`/${sibSlug}`);
            return;
          }
          const childSlug = `${content.slug}/analyses/${parsed.id}`;
          const childNode = graphNodes.find((n) => n.slug === childSlug);
          if (!childNode) return;
          navigate(`/${childSlug}`);
          return;
        }
      }
      return;
    }

    // Fiber link path (href starts with `/`).
    if (!href.startsWith('/')) return;
    e.preventDefault();
    const slug = href.replace(/^\//, '');
    const node = graphNodes.find((candidate) => candidate.slug === slug);
    if (!node) {
      navigate(href);
      return;
    }
    openCard({ type: 'fiber', node });
  }, [graphNodes, navigate, currentNode, parentSubSlugs, parentNode, content.slug, themeId]);

  return (
    <div className="vellum-prose-wrapper" ref={wrapperRef}>
      <article
        className="vellum-prose vellum-prose--pretext"
        ref={proseRef}
        onClick={handleProseClick}
        // Without aria-label the article's accessible name is auto-computed
        // from descendant text, producing run-on strings like "themelinear
        // marginpersonalPortolanportolanrootPortolan charts were medieval…"
        // (theme-picker buttons + tags + h1 + lede). Naming the article
        // after the fiber gives screen readers a clean landmark to land on,
        // mirrors the FiberHeader's title resolution, and matches the same
        // fix applied at the modal-container level (portolan 98bffa4).
        aria-label={
          content.frontmatter?.name ??
          content.frontmatter?.title ??
          currentNode?.label ??
          'Untitled'
        }
      >
        {editorBuffer === null && (
          <>
            {/* Theme picker sits above the fiber title in every theme —
                the FloatingIsland (where it used to live) is hidden in
                lightcone-linear, so any chrome common to all three themes
                belongs inside the prose column itself. */}
            <ThemePicker />
            {/* Annotation bulk-action bar surfaces above the masthead so
                the actions are visible regardless of whether the
                FloatingIsland chrome is gated by the active theme.
                Renders only when both annotations exist on the page and
                the host registered actions via AnnotationActionsProvider. */}
            <NarrativeAnnotationActionsBar
              annotations={annotations}
              bulkActions={annotationBulkActions}
              onRefreshAnnotations={refreshAnnotations}
            />
            <FiberHeader
              frontmatter={content.frontmatter ?? {}}
              graphNode={currentNode}
              lede={lede}
            />
            <AuthoringLintStrip messages={content.messages} />
          </>
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
            <FindingsProvider
              findings={currentNode?.findings ?? []}
              hostNode={currentNode}
            >
              <PretextProse
                mdast={cleanAst}
                contentWidth={contentWidth}
              />
              {/* Margin placement of the stepper, for themes whose layout
                  carries a margin column. Sits beside the findings prose
                  as a card rather than interrupting the narrative flow. */}
              {showMarginColumn && (currentNode?.findings?.length ?? 0) > 0 && (
                <MarginFindingsStepper
                  proseRef={proseRef}
                  wrapperRef={wrapperRef}
                />
              )}
            </FindingsProvider>
          </ArticleProvider>
        )}

        {editorBuffer === null && (
          <AstraAppendix
            node={currentNode}
            width={contentWidth}
            onNavigate={(s) => navigate(`/${s}`)}
            childSubKeys={childSubKeys}
            subAnalysisLabels={subAnalysisLabels}
            subAnalysisSlugs={childSubSlugs}
          />
        )}

        {editorBuffer === null && theme.layout.figureGallery === 'section-end' && (
          <FigureGallery node={currentNode} />
        )}
      </article>

      {showNarrativeCounter && (
        <NarrativeCounter
          node={currentNode}
          refCount={refCount}
          analysisCount={analysisCount}
        />
      )}
      {showMarginColumn && (
        <>
          <MarginCitations
            nodes={graphNodes}
            proseRef={proseRef}
            wrapperRef={wrapperRef}
            changedIds={changedIds}
            currentNode={currentNode}
            childSubKeys={childSubKeys}
            subAnalysisLabels={subAnalysisLabels}
            parentSubKeys={parentSubKeys}
            parentSubLabels={parentSubLabels}
            parentSubSlugs={parentSubSlugs}
          />
        </>
      )}
      {theme.layout.marginColumn === 'empty-gutter-hover' && (
        <GutterHoverCard
          proseRef={proseRef}
          wrapperRef={wrapperRef}
          currentNode={currentNode}
          nodes={graphNodes}
          childSubKeys={childSubKeys}
          parentSubKeys={parentSubKeys}
          parentSubSlugs={parentSubSlugs}
        />
      )}
      {showLeftRailToc && <LeftRailToc proseRef={proseRef} node={currentNode} />}
      {showGhostToc && (
        <GhostToc
          proseRef={proseRef}
          wrapperRef={wrapperRef}
        />
      )}
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
