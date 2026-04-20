/**
 * Shared content types for the Vellum reader.
 *
 * Pure type declarations — no runtime code. Safe to import from either
 * browser components (which call `api.ts`) or tests and tooling. This file must not
 * reference `process`, `node-fetch`, or any node built-ins.
 */

export interface FiberContent {
  slug: string;
  kind?: string;
  /**
   * Parsed mdast tree from mystra. Optional because the content server can
   * legitimately return nothing when a fiber has no body.
   * Callers must guard before handing it to MyST.
   */
  mdast?: any;
  frontmatter: Record<string, any>;
  references?: any;
  dependencies?: string[];
}

/**
 * Normalized evidence detail emitted by mystra's graph builder (see
 * mystra/src/server/routes/graph.ts `GraphEvidence`). Mirrors the shape
 * exactly so the Vellum FindingCard (§4 evidence-artifact renderer) can
 * switch on `kind` and render the four kinds — quote, figure, code,
 * finding — in the same card geometry. The `insight` discriminator
 * token is kept for schema alignment with mystra's graph route; at the
 * UI layer it is labeled as "Finding" so the reader sees one word.
 */
export type GraphEvidenceKind = 'quote' | 'figure' | 'code' | 'insight' | 'unknown';

export interface GraphEvidence {
  id: string;
  kind: GraphEvidenceKind;
  doi?: string;
  quote?: { exact: string; prefix?: string; suffix?: string };
  location?: { page?: number; value?: string };
  artifact?: string;
  figure?: { label: string; caption?: string };
  table?: { label: string; caption?: string; region?: string };
}

export interface GraphFinding {
  key: string;
  /**
   * `finding` = new-knowledge-from-this-analysis (top-level renderable).
   * `prior_insight` = existing literature used as decision-level evidence
   * (demoted in the paper-shaped rendering: show inside decision cards,
   * not as top-level items). See themes-constitution Pass 6.
   */
  kind?: 'finding' | 'prior_insight';
  claim: string;
  hasEvidence: boolean;
  evidence?: GraphEvidence[];
  scope?: string;
  notes?: string;
}

/** Per-option prior_insight reference — key + claim text — for the
 *  decision-card display of "why this option." Resolved upstream in
 *  mystra's summarizeDecisions against the analysis's `prior_insights` bag.
 */
export interface GraphOptionInsight {
  key: string;
  claim: string;
}

export interface GraphDecision {
  key: string;
  label: string;
  rationale?: string;
  selectedKey?: string;
  selectedLabel?: string;
  selectedInsights?: GraphOptionInsight[];
  excluded: Array<{
    key: string;
    label: string;
    reason?: string;
    insights?: GraphOptionInsight[];
  }>;
}

export interface GraphInput {
  id: string;
  kind: 'data' | 'analysis';
  description?: string;
  from?: string;
  source?: string;
}

export interface GraphOutput {
  id: string;
  kind: string;
  description?: string;
  recipe?: string;
  from?: string;
  recipeInputs?: string[];
}

export interface GraphNode {
  id: string;
  label: string;
  slug: string;
  createdAt?: string;
  kind?: string;
  status: string;
  tags: string[];
  verdict?: string;
  decisions?: GraphDecision[];
  findings?: GraphFinding[];
  inputs?: GraphInput[];
  outputs?: GraphOutput[];
  decisionCount?: number;
  findingCount?: number;
  tempered?: boolean;
  depth?: number;
  narrative?: boolean;
  hasASTRA?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: 'contains' | 'data-flow' | 'cites';
}

export interface AstraGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface SearchHit {
  id: string;
  title: string;
  status: string;
  tags: string[];
  snippet?: string;
  outcome?: string;
  score: number;
}

/** Annotation shape from the content server.
 *
 * Two anchoring surfaces coexist:
 *
 *   - Fiber anchoring (lightcone, vellum's original model): `slug` identifies
 *     the fiber, `paragraphIndex` the paragraph within the MyST-rendered body.
 *   - File anchoring (portolan code files): `filePath` + `originId` identify
 *     the file on disk, `from`/`to` are CodeMirror char offsets, `line`/
 *     `endLine` are 1-indexed line numbers for gutter rendering, and
 *     `originalText` is the captured selection. Hosts that don't anchor to
 *     files simply leave these undefined.
 */
/**
 * Host-defined action on an annotation. Rendered as a button in the annotation
 * UI (e.g. inside the click-popover next to Edit/Delete). Each action is
 * identified by `id`, labeled with `label`, and invoked with the annotation
 * object. The handler may be sync or async; vellum fires it and forgets.
 *
 * Use cases: portolan's "send to worker" and "save as fiber" routes. Vellum
 * itself stays host-agnostic — the actions live in the consumer.
 */
export interface AnnotationAction {
  id: string;
  label: string;
  /** Optional tooltip (button title=). Defaults to `label` if omitted. */
  title?: string;
  onInvoke: (annotation: Annotation) => void | Promise<void>;
}

/**
 * Host-defined bulk action rendered in the file viewer's top chrome (modal
 * header or page toolbar) when at least one annotation is attached. Receives
 * the full annotation list plus the anchor element of the button so hosts
 * can render their own popovers/pickers positioned against it.
 */
export interface AnnotationBulkAction {
  id: string;
  label: string;
  title?: string;
  onInvoke: (
    annotations: Annotation[],
    ctx: { anchor: HTMLElement },
  ) => void | Promise<void>;
}

export interface Annotation {
  id: string;
  slug: string;
  /** 'text' (paragraph-anchored) or 'image' (lightbox marker). Defaults to 'text'. */
  kind: 'text' | 'image';
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  comment: string;
  createdAt: number;
  author?: string;
  paragraphIndex?: number;
  // Image annotation fields (kind === 'image')
  x?: number;
  y?: number;
  imageSrc?: string;
  // File-anchoring fields (portolan code-file annotations)
  filePath?: string;
  originId?: string;
  from?: number;
  to?: number;
  line?: number;
  endLine?: number;
  /** Captured selection text at the moment the annotation was created. */
  originalText?: string;
}

export interface RawFiber {
  slug: string;
  body: string;
  sha256: string;
}

export interface LogEvent {
  at: string;
  type: string;
  fiberId: string;
  title: string;
  status: string;
  tags: string[];
  outcome?: string;
}

export interface LogResponse {
  since: string | null;
  count: number;
  events: LogEvent[];
}

/**
 * A project file served through the adapter's `getFile` surface.
 *
 * Represents an arbitrary file the reader can display (code, markdown, pdf,
 * image, html). Distinct from `FiberContent`, which is myst-rendered.
 *
 * `kind` is a coarse classifier so consumers can pick a renderer without
 * sniffing the path. `language` is the CodeMirror language identifier for
 * text kinds; empty for non-text kinds. For binary kinds (`pdf`, `image`,
 * `html`) `content` is an empty string and `url` points to the bytes.
 */
export interface FileContent {
  /** Path as provided by the host (may be absolute or origin-relative). */
  path: string;
  /** Coarse renderer selector. */
  kind: 'text' | 'markdown' | 'pdf' | 'image' | 'html';
  /** CodeMirror language id for text/markdown; '' otherwise. */
  language: string;
  /** File body for text/markdown; '' for binary kinds. */
  content: string;
  /** Raw-bytes URL for binary kinds (pdf, image, html). */
  url?: string;
  /**
   * Parsed mdast for `kind: 'markdown'` files. When present, the reader renders
   * via myst-to-react; when absent (or when the host is a pre-parse adapter),
   * the markdown body falls back to the source-view text reader. Opaque type
   * to match FiberContent.mdast.
   */
  mdast?: any;
}
