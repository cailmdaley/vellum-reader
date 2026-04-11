/**
 * fiber-status — one source of truth for how a fiber's status is rendered.
 *
 * Every surface that shows a fiber reaches for the same handful of things:
 * a glyph (○ ◐ ● · ◈ ✕), a diamond override when the node carries decisions,
 * a normalized status name for CSS classes, and the recurring "strip the
 * leading `> ` off a verdict" dance. Each of these used to live inline in
 * six different components, slightly drifted in each. Put them here.
 *
 * Safe to import from any component — no runtime dependencies.
 */

import type { GraphNode } from './content-types';

/**
 * Single-character glyphs keyed by status. `resolved` is a legacy mystra
 * alias for `closed`; both map to the same filled dot.
 */
export const STATUS_GLYPHS: Record<string, string> = {
  open:       '○',
  active:     '◐',
  closed:     '●',
  suspended:  '·',
  resolved:   '●',
  suspicious: '◈',
  blocked:    '✕',
};

/** Glyph used when the node carries one or more decisions. */
export const DECISION_GLYPH = '◇';

/** Fallback glyph for unknown statuses. */
const UNKNOWN_GLYPH = '○';

/** Status glyph with a safe fallback. */
export function statusGlyph(status: string): string {
  return STATUS_GLYPHS[status] ?? UNKNOWN_GLYPH;
}

/**
 * Like `statusGlyph`, but returns `◇` when the node has decisions.
 * Use for surfaces where decision-ness dominates the indicator
 * (margin citation glyphs, link hover tooltips).
 */
export function glyphForNode(
  node: Pick<GraphNode, 'status' | 'decisions'>,
): string {
  if (node.decisions && node.decisions.length > 0) return DECISION_GLYPH;
  return statusGlyph(node.status);
}

/** Normalize legacy mystra statuses: `resolved` → `closed`. */
export function normalizeStatus(status: string): string {
  return status === 'resolved' ? 'closed' : status;
}

/** Status classes that have matching CSS rules. */
const VALID_STATUS_CLASSES = new Set([
  'open',
  'active',
  'closed',
  'suspended',
  'suspicious',
  'blocked',
]);

/**
 * CSS class suffix for a status — use as
 * ``className={`margin-glyph--${statusClass(s)}`}``. Unknown statuses
 * fall back to `open` so the rendered element always has a valid class.
 */
export function statusClass(status: string): string {
  const normalized = normalizeStatus(status);
  return VALID_STATUS_CLASSES.has(normalized) ? normalized : 'open';
}

/**
 * Strip a leading markdown blockquote prefix (`> `) and trim. Returns
 * `undefined` when the result is empty, so callers can guard with a
 * single `if`.
 */
export function cleanVerdict(v?: string): string | undefined {
  if (!v) return v;
  return v.replace(/^>\s*/, '').trim() || undefined;
}
