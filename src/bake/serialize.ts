import { existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

import { astToPlainText, markdownToMystAST } from './markdown.js';
import { buildSearchIndex } from './search-index.js';
import type {
  EmbedAsset,
  FeltFiber,
  FiberContent,
  FiberGraph,
  GraphDecision,
  GraphEvidence,
  GraphEvidenceKind,
  GraphFinding,
  GraphInput,
  GraphNode,
  GraphOptionInsight,
  GraphOutput,
  PublicationBundle,
  SearchDocument,
} from './types.js';

interface BuildOptions {
  depth: number;
}

export function buildPublicationBundle(
  fibers: FeltFiber[],
  rootFiber: FeltFiber,
  options: BuildOptions,
): PublicationBundle {
  const publicationSlug = rootFiber.slug;
  const allById = new Map(fibers.map((fiber) => [fiber.id, fiber] as const));
  const byTail = new Map<string, FeltFiber[]>();
  for (const fiber of fibers) {
    const bucket = byTail.get(fiber.slug) ?? [];
    bucket.push(fiber);
    byTail.set(fiber.slug, bucket);
  }

  const includedFibers = fibers.filter((fiber) => isFiberIncluded(rootFiber, fiber, options.depth));
  const relativeSlugBySourceId = new Map<string, string>(
    includedFibers.map((fiber) => [fiber.id, bundleSlug(publicationSlug, rootFiber, fiber)] as const),
  );
  const internalBySlug = new Map<string, FeltFiber>(
    includedFibers.map((fiber) => [relativeSlugBySourceId.get(fiber.id)!, fiber] as const),
  );

  const stubNodes = new Map<string, GraphNode>();
  const contents: FiberContent[] = [];
  const searchDocuments: SearchDocument[] = [];
  const embeds: EmbedAsset[] = [];

  const resolveFiberRef = (ref: string): FeltFiber | null => {
    const exact = allById.get(ref);
    if (exact) return exact;

    const tailMatches = byTail.get(ref) ?? [];
    if (tailMatches.length > 1) {
      throw new Error(
        `Bare slug \"${ref}\" is ambiguous during bake: ${tailMatches
          .map((fiber) => fiber.id)
          .join(', ')}`,
      );
    }
    return tailMatches[0] ?? null;
  };

  const ensureStub = (fiber: FeltFiber): GraphNode => {
    const stubSlug = fiber.id;
    const existing = stubNodes.get(stubSlug);
    if (existing) return existing;
    const node = graphNodeFromFiber(fiber, stubSlug, Infinity);
    stubNodes.set(stubSlug, node);
    return node;
  };

  const rewriteLinks = (node: any): any => {
    if (!node || typeof node !== 'object') return node;

    if (node.type === 'link' && typeof node.url === 'string') {
      const ref = extractFiberRef(node.url);
      const children = Array.isArray(node.children) ? node.children.map(rewriteLinks) : node.children;
      if (!ref) return { ...node, children };

      const target = resolveFiberRef(ref);
      if (!target) {
        console.warn(`[vellum-reader bake] unresolved fiber ref ${ref}`);
        return { ...node, children };
      }

      const internalSlug = relativeSlugBySourceId.get(target.id);
      if (internalSlug) {
        return { ...node, url: `/${internalSlug}`, children };
      }

      const stub = ensureStub(target);
      return { ...node, url: `/${stub.slug}`, children };
    }

    if (Array.isArray(node.children)) {
      return { ...node, children: node.children.map(rewriteLinks) };
    }

    return node;
  };

  for (const fiber of includedFibers) {
    const slug = relativeSlugBySourceId.get(fiber.id)!;
    const baseMdast = rewriteLinks(markdownToMystAST(fiber.body));
    const withAutoReport = autoInjectReport(baseMdast, fiber);
    const mdast = rewriteEmbeds(withAutoReport, fiber, slug, embeds);
    const frontmatter = {
      ...fiber.frontmatter,
      name: fiber.frontmatter.name ?? fiber.title,
      title: fiber.frontmatter.title ?? fiber.frontmatter.name ?? fiber.title,
      status: fiber.status,
      tags: fiber.tags,
      ...(fiber.outcome ? { outcome: fiber.outcome } : {}),
      ...(fiber.createdAt ? { 'created-at': fiber.createdAt } : {}),
      ...(fiber.closedAt ? { 'closed-at': fiber.closedAt } : {}),
    };
    contents.push({
      slug,
      kind: 'Article',
      mdast,
      frontmatter,
      references: {},
      dependencies: [],
    });
    searchDocuments.push({
      id: slug,
      title: fiber.title,
      status: fiber.status,
      tags: fiber.tags,
      outcome: fiber.outcome,
      body: astToPlainText(mdast).replace(/\s+/g, ' ').trim(),
    });
  }

  const graphNodes = includedFibers.map((fiber) =>
    graphNodeFromFiber(
      fiber,
      relativeSlugBySourceId.get(fiber.id)!,
      descendantDepth(rootFiber, fiber),
    ),
  );

  const graphLinks: FiberGraph['links'] = [];
  const outputToInternalSlug = new Map<string, string>();
  for (const fiber of includedFibers) {
    const internalSlug = relativeSlugBySourceId.get(fiber.id)!;
    for (const output of fiber.analysis.outputs ?? []) {
      if (typeof output?.id === 'string' && output.id) {
        outputToInternalSlug.set(output.id, internalSlug);
      }
    }
  }

  for (const fiber of includedFibers) {
    const targetSlug = relativeSlugBySourceId.get(fiber.id)!;
    const targetNode = internalBySlug.get(targetSlug)!;

    if (fiber.parentId && relativeSlugBySourceId.has(fiber.parentId)) {
      graphLinks.push({
        source: relativeSlugBySourceId.get(fiber.parentId)!,
        target: targetSlug,
        kind: 'contains',
      });
    }

    for (const depId of fiber.dependsOn) {
      const depFiber = resolveFiberRef(depId);
      const sourceSlug = depFiber ? relativeSlugBySourceId.get(depFiber.id) : undefined;
      if (sourceSlug && sourceSlug !== targetSlug && !hasLink(graphLinks, sourceSlug, targetSlug)) {
        graphLinks.push({ source: sourceSlug, target: targetSlug, kind: 'data-flow' });
      }
    }

    for (const input of fiber.analysis.inputs ?? []) {
      const from = typeof input?.from === 'string' ? input.from : typeof input?.ref === 'string' ? input.ref : undefined;
      if (!from) continue;
      const dotIndex = from.indexOf('.');
      const sourceRef = dotIndex >= 0 ? from.slice(0, dotIndex) : from;
      const outputRef = dotIndex >= 0 ? from.slice(dotIndex + 1) : from;
      const sourceSlug = outputToInternalSlug.get(outputRef) ?? (() => {
        const sourceFiber = resolveFiberRef(sourceRef);
        return sourceFiber ? relativeSlugBySourceId.get(sourceFiber.id) : undefined;
      })();
      if (sourceSlug && sourceSlug !== targetSlug && !hasLink(graphLinks, sourceSlug, targetSlug)) {
        graphLinks.push({ source: sourceSlug, target: targetSlug, kind: 'data-flow' });
      }
    }

    for (const ref of fiber.bodyRefs) {
      const sourceFiber = resolveFiberRef(ref);
      const sourceSlug = sourceFiber ? relativeSlugBySourceId.get(sourceFiber.id) : undefined;
      if (sourceSlug && sourceSlug !== targetSlug && !hasLink(graphLinks, sourceSlug, targetSlug)) {
        graphLinks.push({ source: sourceSlug, target: targetSlug, kind: 'cites' });
      }
    }

    void targetNode;
  }

  const graph: FiberGraph = {
    nodes: [...graphNodes, ...stubNodes.values()],
    links: graphLinks,
    rootSlug: publicationSlug,
  };

  return {
    graph,
    contents,
    stubs: [...stubNodes.values()],
    search: buildSearchIndex(searchDocuments),
    rootFiber,
    publicationSlug,
    embeds,
  };
}

/**
 * Convention: if a fiber's directory carries a sibling `report.html`,
 * prepend a synthetic `htmlEmbed` node to the AST so vellum renders
 * the report above the markdown body without the author needing to
 * write `:::{embed-html} report.html` explicitly.
 *
 * The split that motivates this: `outcome:` and `felt history` stay
 * plain text — they're the surfaces agents read when chaining sessions
 * (kanban skim, warm-up reads). `report.html` is the surface humans
 * read — rich layout, designed per-fiber, full visual freedom. The
 * body markdown narrows to spec sections (Desired State, Context)
 * that genuinely want correction-edited prose.
 *
 * If the author already references `report.html` explicitly (via the
 * embed directive or otherwise), no second injection happens.
 */
function autoInjectReport(mdast: any, fiber: FeltFiber): any {
  if (!mdast || typeof mdast !== 'object' || !Array.isArray(mdast.children)) {
    return mdast;
  }
  const reportPath = join(dirname(fiber.filePath), 'report.html');
  if (!existsSync(reportPath)) return mdast;
  if (alreadyReferencesReport(mdast)) return mdast;
  const synthetic = {
    type: 'htmlEmbed',
    src: 'report.html',
    autoInjected: true,
  };
  return { ...mdast, children: [synthetic, ...mdast.children] };
}

function alreadyReferencesReport(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (
    node.type === 'htmlEmbed' &&
    typeof node.src === 'string' &&
    node.src.trim() === 'report.html'
  ) {
    return true;
  }
  if (Array.isArray(node.children)) {
    return node.children.some(alreadyReferencesReport);
  }
  return false;
}

/**
 * Walk `node` looking for `htmlEmbed` AST nodes (emitted by the `embed`
 * MyST directive). For each one:
 *   - Reject paths that escape the fiber directory (`..` or leading `/`).
 *   - Resolve the authored relative path against the fiber's filesystem
 *     directory and queue a source→dest copy into `outputs`.
 *   - Rewrite the node's `src` to the publication-relative URL
 *     (`embeds/<bundle-slug>/<authored-path>`) that the renderer will
 *     resolve against `window.__VELLUM_STATIC__.publicationBase`.
 * Returns a fresh copy of the AST with the rewritten nodes; the original
 * tree is left intact so MyST parse caches stay clean.
 */
function rewriteEmbeds(
  node: any,
  fiber: FeltFiber,
  bundleSlug: string,
  outputs: EmbedAsset[],
): any {
  if (!node || typeof node !== 'object') return node;

  if (node.type === 'htmlEmbed' && typeof node.src === 'string') {
    const authored = node.src.trim();
    if (!authored || authored.startsWith('/') || authored.split('/').some((segment: string) => segment === '..')) {
      console.warn(
        `[vellum-reader bake] rejected embed src "${authored}" in ${fiber.id} (must be a relative path within the fiber directory)`,
      );
      return { ...node, src: '', invalid: true };
    }
    const sourcePath = resolvePath(dirname(fiber.filePath), authored);
    const destRelative = `embeds/${bundleSlug}/${authored}`;
    outputs.push({ sourcePath, destRelative });
    return { ...node, src: destRelative };
  }

  if (Array.isArray(node.children)) {
    return { ...node, children: node.children.map((child: any) => rewriteEmbeds(child, fiber, bundleSlug, outputs)) };
  }

  return node;
}

function extractFiberRef(url: string): string | null {
  if (url.startsWith('felt://')) return url.slice('felt://'.length);
  if (/^\/[a-z0-9][a-z0-9\-/]*$/.test(url)) return url.slice(1);
  return null;
}

function hasLink(links: FiberGraph['links'], source: string, target: string): boolean {
  return links.some((link) => link.source === source && link.target === target);
}

function isFiberIncluded(rootFiber: FeltFiber, fiber: FeltFiber, depth: number): boolean {
  if (fiber.id === rootFiber.id) return true;
  if (!fiber.id.startsWith(`${rootFiber.id}/`)) return false;
  if (depth === 0) return true;
  return descendantDepth(rootFiber, fiber) < depth;
}

function descendantDepth(rootFiber: FeltFiber, fiber: FeltFiber): number {
  if (fiber.id === rootFiber.id) return 0;
  const relative = fiber.id.slice(rootFiber.id.length + 1);
  return relative.split('/').length;
}

function bundleSlug(publicationSlug: string, rootFiber: FeltFiber, fiber: FeltFiber): string {
  if (fiber.id === rootFiber.id) return publicationSlug;
  return `${publicationSlug}/${fiber.id.slice(rootFiber.id.length + 1)}`;
}

function graphNodeFromFiber(fiber: FeltFiber, slug: string, depth: number): GraphNode {
  const decisions = Object.entries(fiber.analysis.decisions ?? {});
  const findings = taggedInsightEntries(fiber);
  const outputIds = new Set((fiber.analysis.outputs ?? []).flatMap((output: any) =>
    typeof output?.id === 'string' ? [output.id] : [],
  ));
  const insightIds = new Set(findings.map(([key]) => key));
  const hasStructuredData =
    decisions.length > 0 ||
    findings.length > 0 ||
    (fiber.analysis.inputs?.length ?? 0) > 0 ||
    (fiber.analysis.outputs?.length ?? 0) > 0;

  return {
    id: slug,
    label: fiber.title,
    slug,
    kind: 'analysis',
    createdAt: fiber.createdAt,
    status: fiber.status,
    tags: fiber.tags,
    verdict: fiber.outcome ?? extractVerdict(fiber) ?? extractLeadParagraph(fiber.body),
    decisionCount: decisions.length,
    findingCount: findings.length,
    decisions: summarizeDecisions(fiber.analysis.decisions, fiber.analysis.prior_insights),
    findings: summarizeFindings(findings, outputIds, insightIds),
    inputs: summarizeInputs(fiber.analysis.inputs),
    outputs: summarizeOutputs(fiber.analysis.outputs),
    tempered: fiber.tempered,
    depth: Number.isFinite(depth) ? depth : undefined,
    narrative: fiber.narrative,
    hasStructuredData,
  };
}

function taggedInsightEntries(fiber: FeltFiber): Array<[string, any, GraphFinding['kind']]> {
  return [
    ...Object.entries(fiber.analysis.prior_insights ?? {}).map(
      ([key, value]) => [key, value, 'prior_insight' as const] as [string, any, GraphFinding['kind']],
    ),
    ...Object.entries(fiber.analysis.findings ?? {}).map(
      ([key, value]) => [key, value, 'finding' as const] as [string, any, GraphFinding['kind']],
    ),
  ];
}

function resolveOptionInsights(
  keys: unknown,
  priorInsights: Record<string, any> | undefined,
): GraphOptionInsight[] | undefined {
  if (!Array.isArray(keys) || keys.length === 0 || !priorInsights) return undefined;
  const out: GraphOptionInsight[] = [];
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    const entry = priorInsights[key];
    const claim = entry?.claim ?? entry?.description;
    if (!claim) continue;
    out.push({ key, claim });
  }
  return out.length > 0 ? out : undefined;
}

function summarizeDecisions(
  raw: Record<string, any> | undefined,
  priorInsights?: Record<string, any>,
): GraphDecision[] | undefined {
  if (!raw) return undefined;
  const out: GraphDecision[] = [];

  for (const [key, value] of Object.entries(raw)) {
    const decision = value as any;
    if (decision.from && !decision.options && !decision.label) continue;

    const options = decision.options ?? {};
    const selectedKey = decision.default ?? decision.selected_key;
    const selectedLabel =
      decision.selected_label ??
      (selectedKey && options[selectedKey]?.label) ??
      selectedKey;
    const excluded: GraphDecision['excluded'] = [];

    for (const [optionKey, optionValue] of Object.entries(options)) {
      if (optionKey === selectedKey) continue;
      const option = optionValue as any;
      excluded.push({
        key: optionKey,
        label: option.label ?? optionKey,
        reason: option.excluded_reason,
        insights: resolveOptionInsights(option.insights, priorInsights),
      });
    }

    if (decision.excluded && typeof decision.excluded === 'object' && excluded.length === 0) {
      for (const [excludedKey, excludedValue] of Object.entries(decision.excluded)) {
        const option = excludedValue as any;
        excluded.push({
          key: excludedKey,
          label: option.label ?? excludedKey,
          reason: option.excluded_reason,
          insights: resolveOptionInsights(option.insights, priorInsights),
        });
      }
    }

    out.push({
      key,
      label: decision.label ?? key,
      rationale: decision.rationale,
      selectedKey,
      selectedLabel,
      selectedInsights: selectedKey
        ? resolveOptionInsights(options[selectedKey]?.insights, priorInsights)
        : undefined,
      excluded,
    });
  }

  return out.length > 0 ? out : undefined;
}

function summarizeInputs(raw: any[] | undefined): GraphInput[] | undefined {
  if (!raw?.length) return undefined;
  return raw
    .filter((input) => typeof input?.id === 'string')
    .map((input) => ({
      id: input.id,
      kind: input.type === 'analysis' ? 'analysis' : 'data',
      label: input.label,
      description: input.description,
      from: input.from ?? input.ref,
      source: input.source,
    }));
}

function summarizeOutputs(raw: any[] | undefined): GraphOutput[] | undefined {
  if (!raw?.length) return undefined;
  return raw
    .filter((output) => typeof output?.id === 'string')
    .map((output) => ({
      id: output.id,
      kind: output.type ?? output.kind ?? 'artifact',
      label: output.label,
      description: output.description,
      recipe: output.recipe?.command,
      from: output.from,
      recipeInputs: Array.isArray(output.recipe?.inputs) ? output.recipe.inputs : undefined,
    }));
}

function classifyEvidence(
  evidence: any,
  outputIds: Set<string>,
  insightIds: Set<string>,
): GraphEvidenceKind {
  if (evidence?.doi) return 'quote';
  if (typeof evidence?.artifact === 'string') {
    if (outputIds.has(evidence.artifact)) return 'figure';
    if (insightIds.has(evidence.artifact)) return 'insight';
  }
  return 'unknown';
}

function normalizeEvidence(
  raw: any[] | undefined,
  outputIds: Set<string>,
  insightIds: Set<string>,
): GraphEvidence[] | undefined {
  if (!raw?.length) return undefined;
  return raw.map((evidence, index) => ({
    id: evidence?.id ?? `e${index + 1}`,
    kind: classifyEvidence(evidence, outputIds, insightIds),
    doi: evidence?.doi,
    quote: evidence?.quote
      ? {
          exact: evidence.quote.exact ?? '',
          prefix: evidence.quote.prefix,
          suffix: evidence.quote.suffix,
        }
      : undefined,
    location: evidence?.location
      ? { page: evidence.location.page, value: evidence.location.value }
      : undefined,
    artifact: evidence?.artifact,
    figure: evidence?.figure
      ? { label: evidence.figure.label ?? '', caption: evidence.figure.caption }
      : undefined,
    table: evidence?.table
      ? {
          label: evidence.table.label ?? '',
          caption: evidence.table.caption,
          region: evidence.table.region,
        }
      : undefined,
  }));
}

function summarizeFindings(
  entries: Array<[string, any, GraphFinding['kind']]>,
  outputIds: Set<string>,
  insightIds: Set<string>,
): GraphFinding[] | undefined {
  if (entries.length === 0) return undefined;
  const out: GraphFinding[] = [];

  for (const [key, value, kind] of entries) {
    const claim = value?.claim ?? value?.description ?? '';
    if (!claim) continue;
    const rawEvidence = Array.isArray(value?.evidence) ? value.evidence : undefined;
    out.push({
      key,
      kind,
      label: typeof value?.label === 'string' ? value.label : undefined,
      claim,
      hasEvidence: !!rawEvidence?.length,
      evidence: normalizeEvidence(rawEvidence, outputIds, insightIds),
      scope: value?.scope,
      notes: value?.notes,
    });
  }

  return out.length > 0 ? out : undefined;
}

function extractVerdict(fiber: FeltFiber): string | undefined {
  const entries = [
    ...Object.values(fiber.analysis.prior_insights ?? {}),
    ...Object.values(fiber.analysis.findings ?? {}),
  ];
  const claim = entries.find((entry: any) => typeof entry?.claim === 'string')?.claim;
  if (claim) return truncate(claim);
  const rationale = Object.values(fiber.analysis.decisions ?? {}).find(
    (decision: any) => typeof decision?.rationale === 'string',
  ) as { rationale?: string } | undefined;
  return rationale?.rationale ? truncate(rationale.rationale.trim()) : undefined;
}

function truncate(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isPathOnlyLine(line: string): boolean {
  if (line.includes(' ')) return false;
  if (line.startsWith('/') || line.startsWith('~/')) return true;
  return /^[\w.-]+(\/[\w.-]+)+\.[a-z0-9]+$/i.test(line);
}

function extractLeadParagraph(body: string): string | undefined {
  if (!body) return undefined;
  const lines = body.split('\n');
  const paragraph: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inParagraph) break;
      continue;
    }
    if (trimmed.startsWith('#') || isPathOnlyLine(trimmed)) continue;
    inParagraph = true;
    paragraph.push(trimmed);
  }

  if (paragraph.length === 0) return undefined;
  return truncate(paragraph.join(' '));
}
