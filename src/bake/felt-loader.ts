import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import yaml from 'js-yaml';
import type { FeltFiber, FiberAnalysis } from './types.js';

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;
const CROSS_REF_ANCHOR_RE = /^\s*\([^)]+\)=\s*\n/;
const BODY_REF_RE = /\[[^\]]*\]\([/#]([a-z0-9][a-z0-9\-/]*)\)/g;
const WIKILINK_RE = /\[\[([a-z0-9][a-z0-9\-/]*)(?:\|[^\]]*)?\]\]/g;

export function resolveFeltRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    const candidate = basename(current) === '.felt' ? current : join(current, '.felt');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not find .felt/ above ${start}`);
    }
    current = parent;
  }
}

export function resolveFiberSelector(fibers: FeltFiber[], selector: string): FeltFiber {
  const exact = fibers.find((fiber) => fiber.id === selector);
  if (exact) return exact;

  const byTail = fibers.filter((fiber) => fiber.slug === selector);
  if (byTail.length === 1) return byTail[0];
  if (byTail.length > 1) {
    throw new Error(
      `Bare slug \"${selector}\" is ambiguous: ${byTail.map((fiber) => fiber.id).join(', ')}`,
    );
  }

  throw new Error(`No fiber matches \"${selector}\"`);
}

/**
 * Load all fibers from a .felt/ directory.
 */
export function loadFeltDirectory(feltDir: string): FeltFiber[] {
  if (!existsSync(feltDir)) return [];

  const fibers: FeltFiber[] = [];
  const resolvedDir = realpathSync(feltDir);
  const parentName = basename(resolvedDir);
  const flatRootFile = join(feltDir, `${parentName}.md`);

  if (existsSync(flatRootFile) && statSync(flatRootFile).isFile()) {
    const rawContent = readFileSync(flatRootFile, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(rawContent);
    if (frontmatter) {
      const tags = normalizeTags(frontmatter.tags);
      if (!tags.includes('root')) tags.push('root');
      frontmatter.tags = tags;
      fibers.push(buildFiber(parentName, parentName, frontmatter, body, flatRootFile, null));
    }
  }

  walkFeltDir(feltDir, feltDir, null, fibers);
  return fibers;
}

function walkFeltDir(
  baseDir: string,
  currentDir: string,
  parentId: string | null,
  fibers: FeltFiber[],
): void {
  const entries = readdirSync(currentDir);

  for (const entry of entries) {
    const fullPath = join(currentDir, entry);
    if (!statSync(fullPath).isDirectory()) continue;
    if (entry.startsWith('.') || entry === 'node_modules') continue;

    const mdFile = join(fullPath, `${entry}.md`);
    if (!existsSync(mdFile)) continue;

    const fiberId = relative(baseDir, fullPath).replace(/\\/g, '/');
    const rawContent = readFileSync(mdFile, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(rawContent);
    if (!frontmatter) continue;

    const fiber = buildFiber(fiberId, entry, frontmatter, body, mdFile, parentId);
    fibers.push(fiber);
    walkFeltDir(baseDir, fullPath, fiberId, fibers);
  }
}

function buildFiber(
  id: string,
  slug: string,
  fm: Record<string, any>,
  rawBody: string,
  filePath: string,
  parentId: string | null,
): FeltFiber {
  const title = fm.name ?? fm.title ?? slug;
  const status = fm.status ?? 'open';
  const outcome = typeof fm.outcome === 'string' ? fm.outcome : undefined;
  const tags = normalizeTags(fm.tags);
  const tempered = fm.tempered === true;
  const narrative = tags.includes('narrative');
  const dependsOn = normalizeDependsOn(fm['depends-on'] ?? fm.depends_on);
  const createdAt = normalizeTimestamp(fm['created-at'] ?? fm.created_at);
  const closedAt = normalizeTimestamp(fm['closed-at'] ?? fm.closed_at);
  const body = rawBody.replace(CROSS_REF_ANCHOR_RE, '').trim();
  const bodyRefs = extractBodyRefs(body);
  const analysis = frontmatterToAnalysis(fm);

  return {
    id,
    slug,
    title,
    status,
    outcome,
    dependsOn,
    bodyRefs,
    tags,
    tempered,
    narrative,
    createdAt,
    closedAt,
    body,
    frontmatter: fm,
    filePath,
    parentId: parentId ?? undefined,
    analysis,
  };
}

function frontmatterToAnalysis(frontmatter: Record<string, any>): FiberAnalysis {
  const findings = frontmatter.findings ?? frontmatter.insights;
  return {
    decisions: asRecord(frontmatter.decisions),
    prior_insights: asRecord(frontmatter.prior_insights),
    findings: asRecord(findings),
    inputs: Array.isArray(frontmatter.inputs) ? frontmatter.inputs : undefined,
    outputs: Array.isArray(frontmatter.outputs) ? frontmatter.outputs : undefined,
    success_criteria: Array.isArray(frontmatter.success_criteria)
      ? frontmatter.success_criteria
      : undefined,
    narrative: asRecord(frontmatter.narrative),
  };
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
  }
  return undefined;
}

function normalizeTags(tags: unknown): string[] {
  const split = (text: string) => text.split(',').map((tag) => tag.trim()).filter(Boolean);
  const source = Array.isArray(tags) ? tags : typeof tags === 'string' ? [tags] : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of source) {
    if (typeof item !== 'string') continue;
    for (const tag of split(item)) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

function normalizeDependsOn(deps: unknown): string[] {
  if (!Array.isArray(deps)) return [];
  return deps
    .map((dep) => {
      if (typeof dep === 'string') return dep;
      if (dep && typeof dep === 'object' && 'id' in dep && typeof dep.id === 'string') {
        return dep.id;
      }
      return null;
    })
    .filter((dep): dep is string => dep !== null);
}

function parseFrontmatter(content: string): {
  frontmatter?: Record<string, any>;
  body: string;
} {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { body: content };

  try {
    const frontmatter = yaml.load(match[1]) as Record<string, any> | undefined;
    return {
      frontmatter,
      body: content.slice(match[0].length),
    };
  } catch {
    return { body: content };
  }
}

function stripCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, (match) => ' '.repeat(match.length))
    .replace(/`[^`\n]*`/g, (match) => ' '.repeat(match.length));
}

export function extractBodyRefs(body: string): string[] {
  const refs: string[] = [];
  const prose = stripCode(body);
  let match: RegExpExecArray | null;

  BODY_REF_RE.lastIndex = 0;
  while ((match = BODY_REF_RE.exec(prose)) !== null) {
    if (!refs.includes(match[1])) refs.push(match[1]);
  }

  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(prose)) !== null) {
    if (!refs.includes(match[1])) refs.push(match[1]);
  }

  return refs;
}
