/**
 * AuthoringLintStrip — Pass 8 step 2 (themes-constitution).
 *
 * Surfaces `myst-parser`'s authoring-lint messages (collected by mystra in
 * Pass 8 step 1) as a compact strip under the fiber masthead. Collapsed by
 * default — shows a single line "N issues · authoring lint" with a severity
 * chip. Clicking expands into a grouped list (errors first, then warnings,
 * then info), each row carrying ruleId, reason, and source:line:column when
 * present.
 *
 * Scope: surface only messages already emitted by mystra on
 * `FiberContent.messages` (mirror of `PageContent.messages` — see
 * `mystra/src/types/content-server.ts:LintMessage`). `structured validate`
 * broken-anchor errors are the second feed the constitution calls for;
 * they'll join this surface when the validator is wired — same chip,
 * unified counter.
 *
 * Theme-agnostic. Renders under all three themes; styling is shared and
 * lives in `vellum.css`.
 */

import { useMemo, useState } from 'react';
import type { LintMessage } from '~/utils/content-types';

interface AuthoringLintStripProps {
  messages?: LintMessage[];
}

type Severity = LintMessage['severity'];

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];
const SEVERITY_GLYPH: Record<Severity, string> = {
  error: '●',
  warning: '▲',
  info: '○',
};
const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return n === 1 ? singular : plural;
}

/** Short one-line locator: `source:line:column` when available, trimming
 *  to the minimum meaningful form. */
function formatLocation(m: LintMessage): string | null {
  const parts: string[] = [];
  if (m.source) parts.push(m.source);
  if (typeof m.line === 'number') {
    const lc = typeof m.column === 'number' ? `${m.line}:${m.column}` : String(m.line);
    parts.push(lc);
  }
  return parts.length ? parts.join(':') : null;
}

export function AuthoringLintStrip({ messages }: AuthoringLintStripProps) {
  const [expanded, setExpanded] = useState(false);
  const grouped = useMemo(() => {
    const out: Record<Severity, LintMessage[]> = { error: [], warning: [], info: [] };
    for (const m of messages ?? []) out[m.severity].push(m);
    return out;
  }, [messages]);

  const total = (messages ?? []).length;
  if (total === 0) return null;

  const topSeverity: Severity =
    grouped.error.length > 0 ? 'error' : grouped.warning.length > 0 ? 'warning' : 'info';

  // Summary line: "2 errors · 1 warning" compressed to present-only kinds.
  const summaryParts = SEVERITY_ORDER.filter((s) => grouped[s].length > 0).map((s) => {
    const n = grouped[s].length;
    return `${n} ${pluralize(n, SEVERITY_LABEL[s])}`;
  });

  return (
    <div
      className={`vellum-authoring-lint vellum-authoring-lint--${topSeverity}${
        expanded ? ' vellum-authoring-lint--expanded' : ''
      }`}
      role="region"
      aria-label="Authoring lint"
    >
      <button
        type="button"
        className="vellum-authoring-lint__toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
      >
        <span
          className="vellum-authoring-lint__glyph"
          aria-hidden="true"
          data-severity={topSeverity}
        >
          {SEVERITY_GLYPH[topSeverity]}
        </span>
        <span className="vellum-authoring-lint__summary">{summaryParts.join(' · ')}</span>
        <span className="vellum-authoring-lint__label">authoring lint</span>
        <span className="vellum-authoring-lint__caret" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <ul className="vellum-authoring-lint__list" role="list">
          {SEVERITY_ORDER.flatMap((sev) =>
            grouped[sev].map((m, i) => {
              const loc = formatLocation(m);
              return (
                <li
                  key={`${sev}-${i}-${m.ruleId ?? ''}-${m.line ?? ''}`}
                  className={`vellum-authoring-lint__row vellum-authoring-lint__row--${sev}`}
                >
                  <span
                    className="vellum-authoring-lint__row-glyph"
                    data-severity={sev}
                    aria-label={SEVERITY_LABEL[sev]}
                  >
                    {SEVERITY_GLYPH[sev]}
                  </span>
                  {m.ruleId && (
                    <code className="vellum-authoring-lint__rule">{m.ruleId}</code>
                  )}
                  <span className="vellum-authoring-lint__reason">{m.reason}</span>
                  {loc && <span className="vellum-authoring-lint__loc">{loc}</span>}
                  {m.note && (
                    <span className="vellum-authoring-lint__note">{m.note}</span>
                  )}
                </li>
              );
            }),
          )}
        </ul>
      )}
    </div>
  );
}
