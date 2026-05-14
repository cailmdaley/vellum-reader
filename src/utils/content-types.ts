/**
 * Shared content types for the Vellum reader.
 *
 * Pure type declarations — no runtime code. Safe to import from either
 * browser components (which call `api.ts`) or tests and tooling. This file must not
 * reference `process`, `node-fetch`, or any node built-ins.
 *
 * Two flavors of structured types coexist in vellum:
 *
 *   - `Graph*` (defined here): vellum's projection of mystra's graph route
 *     output. Denormalized for card-rendering — paths resolved, evidence
 *     compacted, decisions flattened. This is what every component in
 *     vellum imports day-to-day.
 *
 *   - `structured*` (structural aliases below): the canonical spec-shaped
 *     records, mirroring structured-spec / extern/structured Pydantic models. Reach
 *     for these when working with raw frontmatter or anything upstream of
 *     mystra's graph projection.
 */

// Vellum intentionally keeps these structural: the canonical structured type
// package boundary has moved a few times, while the reader mostly needs to
// carry raw frontmatter-shaped records through without owning validation.
export type structuredAnalysis = Record<string, any>;
export type structuredDecision = Record<string, any>;
export type structuredOption = Record<string, any>;
export type structuredEvidence = Record<string, any>;
export type structuredInput = Record<string, any>;
export type structuredOutput = Record<string, any>;
export type structuredInsight = Record<string, any>;
export type structuredRecipe = Record<string, any>;
export type structuredNarrative = Record<string, any>;
export type structuredNarrativeSection = string | Record<string, any>;
export type structuredUniverse = Record<string, any>;
export type structuredUniverseNode = Record<string, any>;
export type structuredSuccessCriterion = Record<string, any>;
export type TextQuoteSelector = Record<string, any>;
export type FigureSelector = Record<string, any>;
export type TableSelector = Record<string, any>;
export type FragmentSelector = Record<string, any>;

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
  /**
   * Authoring-lint messages emitted by `myst-parser` during the page's
   * parse (Pass 8). Mirror of mystra's `PageContent.messages` — see
   * `mystra/src/types/content-server.ts:LintMessage`. Absent when the
   * page had zero warnings; callers should treat `undefined` as `[]`.
   */
  messages?: LintMessage[];
}

/**
 * Vellum-side mirror of `mystra/src/types/content-server.ts:LintMessage`.
 * Kept in sync by convention — any field added there should appear here.
 */
export interface LintMessage {
  reason: string;
  severity: 'error' | 'warning' | 'info';
  ruleId?: string;
  source?: string;
  line?: number;
  column?: number;
  note?: string;
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
  /** Short human-readable name for compact rendering (margin chip, collapsed
   *  card head). Falls back to `key` when absent. structured-spec feature/narrative. */
  label?: string;
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
  /** Short human-readable name for compact rendering. Falls back to `id`. */
  label?: string;
  description?: string;
  from?: string;
  source?: string;
}

export interface GraphOutput {
  id: string;
  kind: string;
  /** Short human-readable name for compact rendering. Falls back to `id`. */
  label?: string;
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
  hasStructuredData?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: 'contains' | 'data-flow' | 'cites';
}

export interface FiberGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Optional collection root. Hosts can provide this so empty/index routes
   * converge on a real fiber with normal thumb-index context. */
  rootSlug?: string | null;
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
 * header or page toolbar) when at least one annotation is attached.
 *
 * `applicableTo` (optional) prefilters the annotation list passed to
 * `onInvoke` and gates whether the button renders at all — actions like
 * "Clear sent" want to operate only on the subset that already has
 * `sentAt`, and shouldn't appear when no annotation matches. If omitted,
 * the action sees the full annotation list and renders whenever
 * annotations exist.
 *
 * `ctx.anchor` is the button element so hosts can render popovers/pickers
 * positioned against it.
 *
 * `ctx.refreshAnnotations` re-fetches annotations from the source — call
 * after mutating (delete, edit) so the modal reflects the new state
 * without forcing the user to reopen the file.
 */
export interface AnnotationBulkAction {
  id: string;
  label: string;
  title?: string;
  /** When true, the bar/toolbar renders the button in a quietly
   *  destructive register (muted, slightly red on hover) so a wandering
   *  click against an irreversible action — Clear, Delete all — reads
   *  as different from the everyday actions sitting beside it.
   *  Recommended for any action that calls `confirm()` or otherwise
   *  cannot be undone. */
  destructive?: boolean;
  /** Which annotation set this action operates on.
   *
   *  - `'visible'` (default): the anchor-resolved subset currently
   *    rendered as marks. Right for Send / Save-as-fiber — they only
   *    make sense for annotations whose quote still lives in the
   *    document.
   *  - `'stored'`: every annotation persisted under this file/slug,
   *    including "zombies" whose anchors no longer resolve after edits.
   *    Right for Clear — the user's intent is to clean out the store,
   *    not to operate on what happens to render today. With this scope
   *    the chrome surfaces the button whenever the store is non-empty,
   *    even if zero anchors resolve right now.
   *
   *  When unset, the visible list drives both the button's count badge
   *  and the annotation list handed to `onInvoke` (existing semantics). */
  scope?: 'visible' | 'stored';
  applicableTo?: (annotation: Annotation) => boolean;
  onInvoke: (
    annotations: Annotation[],
    ctx: {
      anchor: HTMLElement;
      refreshAnnotations: () => void;
      /** The slug or path the action was invoked from. Set by
       *  `NarrativeAnnotationActionsBar` to the current fiber's slug; left
       *  undefined by `FileViewerModal` (file mode has no slug). Hosts use
       *  it to resolve the fiber's body path for slug-bound operations
       *  (send-to-worker, save-as-child-fiber). */
      currentSlug?: string;
    },
  ) => void | Promise<void>;
}

/**
 * Host-defined per-selection action rendered alongside `+ Note` in the
 * floating selection toolbar. The toolbar sees a fresh prose selection
 * before any annotation has been persisted; a single action takes that
 * raw selection and does something with it (the canonical case is "promote
 * the selection into a new draft fiber" — the read→author bridge from the
 * vellum-marginalia constitution).
 *
 * Surface contract is symmetric to `AnnotationBulkAction` but operates on
 * a transient selection rather than a persisted annotation list. The host
 * reaches here when the user explicitly clicks; nothing renders until at
 * least one action is registered.
 */
export interface AnnotationSingleAction {
  id: string;
  label: string;
  title?: string;
  onInvoke: (
    selection: {
      selectedText: string;
      contextBefore: string;
      contextAfter: string;
    },
    ctx: {
      /** Slug of the fiber the selection was made on. Used by handlers
       *  that need to nest the new artifact under the source — e.g. the
       *  file-as-fiber promote path writes `<sourceSlug>/notes-…`. */
      currentSlug: string;
      /** React Router navigate, plumbed in from `TextAnnotationLayer` so
       *  handlers running outside the router (registered at app startup
       *  in `main.tsx`) can route the user to the artifact they just
       *  created. */
      navigate: (to: string) => void;
    },
  ) => void | Promise<void>;
}

export interface Annotation {
  id: string;
  slug: string;
  /** 'text' (paragraph-anchored) or 'image' (lightbox marker). Defaults to 'text'. */
  kind: 'text' | 'image';
  /** Visual/editorial intent for text annotations. Omitted legacy rows behave as notes. */
  intent?: 'note' | 'delete';
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
  /**
   * Timestamp (ms) when the annotation was sent to a worker. Set by hosts
   * (portolan) that route annotations into a worker queue; bulk actions
   * like "Clear sent" gate on `typeof sentAt === 'number'`.
   */
  sentAt?: number;
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
 * One event from a fiber's `felt history` chain.
 *
 * Two broad event classes:
 *
 * **Editorial** — `kind: 'editorial'`. Agent-written prose summaries appended
 * at session boundaries via `felt history append`. Carry a markdown `summary`
 * and a pre-parsed `summaryAst` for MyST → React rendering.
 *
 * **Mechanical** — `kind: 'external_edit' | 'edit' | 'add' | 'rm'`. Automatic
 * mutations recorded by the felt daemon. No prose summary; carry size metadata
 * and, for `edit` events, the list of changed fields.
 *
 * `kind` is optional for backwards compatibility: older server responses that
 * predate Stage 4 (mechanical-events toggle) do not include it. Consumers
 * should treat `kind === undefined` as `'editorial'`.
 */
export interface HistoryEvent {
  /** ISO 8601 timestamp emitted by the felt CLI (`occurred_at`). */
  occurredAt: string;
  /** Author of the event (`actor`); typically `<user>@<host>` or `external`. */
  actor: string;
  /**
   * Event kind. Editorial events carry prose; mechanical events carry byte
   * metadata. Absent in legacy server responses — treat as `'editorial'`.
   */
  kind?: 'editorial' | 'external_edit' | 'edit' | 'add' | 'rm';
  // ── Editorial-only ──────────────────────────────────────────────────
  /** Raw markdown summary (editorial events only). */
  summary?: string;
  /** Pre-parsed mdast for the summary (editorial events only). */
  summaryAst?: any;
  // ── Mechanical-only ─────────────────────────────────────────────────
  /** Character count after the mutation. */
  sizeChars?: number;
  /** Line count after the mutation. */
  sizeLines?: number;
  /** For `edit` events: list of frontmatter fields changed (e.g. `['tag', 'untag']`). */
  fieldsChanged?: string[];
}

export interface HistoryResponse {
  events: HistoryEvent[];
  /**
   * Endpoint status. `'ok'` (default) means the events list is canonical
   * — possibly empty if the fiber has no history yet. `'unavailable'`
   * means the fetch failed (felt index busy, felt missing, etc.); the
   * client should surface a retry-friendly state instead of pretending
   * there's no history. Optional for backward compat — adapters that
   * don't carry status info default to `'ok'`.
   */
  status?: 'ok' | 'unavailable';
  /** When `status === 'unavailable'`, the discriminator. */
  reason?: 'busy' | 'error';
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
  /**
   * Parsed YAML frontmatter for `kind: 'markdown'` files that have a leading
   * `---\n…\n---` block. Used by the canvas reader to render a FiberHeader
   * lockup when the frontmatter is fiber-shaped (carries a `name`/`title`),
   * and otherwise ignored. Absent when the file has no frontmatter or when
   * the YAML couldn't be parsed.
   */
  frontmatter?: Record<string, unknown>;
}
