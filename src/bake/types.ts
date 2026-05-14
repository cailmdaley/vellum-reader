export interface FiberAnalysis {
  decisions?: Record<string, any>;
  prior_insights?: Record<string, any>;
  findings?: Record<string, any>;
  inputs?: any[];
  outputs?: any[];
  success_criteria?: any[];
  narrative?: Record<string, any>;
}

export interface FeltFiber {
  id: string;
  slug: string;
  title: string;
  status: string;
  outcome?: string;
  dependsOn: string[];
  bodyRefs: string[];
  tags: string[];
  tempered: boolean;
  narrative: boolean;
  createdAt?: string;
  closedAt?: string;
  body: string;
  frontmatter: Record<string, any>;
  filePath: string;
  parentId?: string;
  analysis: FiberAnalysis;
}

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

export interface GraphFinding {
  key: string;
  kind?: 'finding' | 'prior_insight';
  label?: string;
  claim: string;
  hasEvidence: boolean;
  evidence?: GraphEvidence[];
  scope?: string;
  notes?: string;
}

export interface GraphInput {
  id: string;
  kind: 'data' | 'analysis';
  label?: string;
  description?: string;
  from?: string;
  source?: string;
}

export interface GraphOutput {
  id: string;
  kind: string;
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
  rootSlug?: string | null;
}

export interface FiberContent {
  slug: string;
  kind?: string;
  mdast?: any;
  frontmatter: Record<string, any>;
  references?: Record<string, any>;
  dependencies?: string[];
  messages?: LintMessage[];
}

export interface LintMessage {
  reason: string;
  severity: 'error' | 'warning' | 'info';
  ruleId?: string;
  source?: string;
  line?: number;
  column?: number;
  note?: string;
}

export interface SearchDocument {
  id: string;
  title: string;
  status: string;
  tags: string[];
  outcome?: string;
  body: string;
}

export interface SearchIndexPayload {
  documents: SearchDocument[];
  index: Record<string, any>;
}

export interface PublicationBundle {
  graph: FiberGraph;
  contents: FiberContent[];
  stubs: GraphNode[];
  search: SearchIndexPayload;
  rootFiber: FeltFiber;
  publicationSlug: string;
}
