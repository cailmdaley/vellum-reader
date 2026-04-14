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

export interface GraphFinding {
  key: string;
  claim: string;
  hasEvidence: boolean;
}

export interface GraphDecision {
  key: string;
  label: string;
  rationale?: string;
  selectedKey?: string;
  selectedLabel?: string;
  excluded: Array<{ key: string; label: string; reason?: string }>;
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

/** Annotation shape from the content server. */
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
}
