/**
 * FiberHeader — preprint-style masthead for a fiber / analysis page.
 *
 * Pass 6 (themes-constitution): the biggest single "feels like a real paper"
 * cue. The cartouche — title with an ornamented rule below — already lived
 * here. This pass adds an author row beneath the title and a keyword row
 * beneath the rule, drawing on whatever the frontmatter carries.
 *
 * The structured-spec today carries `name`, `authors: string[]`, and `tags:
 * string[]`. mystra threads them onto `PageFrontmatter` (see
 * mystra/src/transform/render-structured-project.ts). When the spec grows richer
 * fields (affiliations, ORCID, DOI, date, venue, license, funding) the
 * masthead reads them through the same permissive `frontmatter` bag and
 * renders them without further wiring. Missing fields degrade to absence,
 * not "Untitled"-style placeholders — the masthead shows only what's real.
 */

import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { GraphNode } from '~/utils/content-types';
import { HISTORY_CARD_ANCHOR_ID } from './HistoryCard';

interface FiberHeaderProps {
  frontmatter: Record<string, any>;
  graphNode?: GraphNode;
  /**
   * Body-extracted lede (from `stripFrontmatterNodes` in NarrativeView).
   * Currently unused by the masthead — the lede slot is sourced directly
   * from `frontmatter.outcome` instead. Kept on the prop signature so the
   * caller can keep passing it without churn; remove when the body-extract
   * path is dropped.
   */
  lede?: string | null;
  /**
   * Number of editorial events on the fiber's `felt history` chain.
   * Drives the ※n indicator next to the cartouche; absent (or 0) silences
   * the indicator so the masthead shows nothing for fibers without
   * accreted history. `※` is the komejirushi (U+203B) — the Japanese
   * editorial-note marker, apt for the editorial-event register.
   */
  historyCount?: number;
}

/**
 * Split a YAML literal-block outcome (`outcome: |-`) into paragraphs.
 *
 * The block-scalar form preserves both the soft line wraps that exist
 * for editor readability *and* the blank lines that separate real
 * paragraphs. Treating the whole string as preformatted gives ugly
 * mid-paragraph hard breaks; splitting on blank lines and joining
 * intra-paragraph wraps with spaces gives clean prose paragraphs.
 */
function paragraphsFromOutcome(raw: string): string[] {
  return raw
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Render a paragraph of outcome text as React children, surfacing
 * the inline syntax that kanban-bound outcomes routinely carry:
 *
 *   - `[[slug]]` and `[[slug|label]]`  → SPA <Link> to /slug
 *   - `` `code` ``                     → <code>
 *   - `**bold**`                       → <strong>
 *   - `*emphasis*`                     → <em>
 *
 * Outcomes are short prose; this is a focused inline-only pass, not
 * the full markdown pipeline (no block-level constructs, no nesting
 * across the four shapes). Wikilinks dominate; the rest cover the
 * cases authors reach for inside an outcome lede. Anything else
 * stays as text. Mirrors the body-side wikilink convention from
 * `mystra/src/transform/render-markdown.ts`: slug becomes `/<slug>`,
 * label defaults to slug.
 *
 * The fall-through case (no inline syntax in the paragraph) returns
 * a single string so paragraphs without wikilinks/code/etc emit a
 * single text node — keeping the DOM identical to the pre-renderer
 * shape for plain prose.
 */
const INLINE_TOKEN_RE =
  /(?<wikilink>\[\[(?<slug>[^\]|]+?)(?:\|(?<label>[^\]]*?))?\]\])|(?<code>`(?<codeval>[^`]+)`)|(?<strong>\*\*(?<strongval>[^*]+)\*\*)|(?<em>\*(?<emval>[^*]+)\*)/g;

function renderInlineOutcome(paragraph: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  // `lastIndex` resets on every fresh paragraph because we re-construct
  // the loop here; the regex object itself is module-scoped but we never
  // pause between calls, so resetting via while-loop completion is fine.
  INLINE_TOKEN_RE.lastIndex = 0;
  while ((m = INLINE_TOKEN_RE.exec(paragraph)) !== null) {
    const start = m.index;
    if (start > last) out.push(paragraph.slice(last, start));
    const groups = m.groups ?? {};
    if (groups.wikilink) {
      const slug = (groups.slug ?? '').trim();
      const label = (groups.label?.trim() || slug);
      out.push(
        <Link key={`w${key++}`} to={`/${slug}`}>
          {label}
        </Link>,
      );
    } else if (groups.code) {
      out.push(<code key={`c${key++}`}>{groups.codeval}</code>);
    } else if (groups.strong) {
      out.push(<strong key={`b${key++}`}>{groups.strongval}</strong>);
    } else if (groups.em) {
      out.push(<em key={`i${key++}`}>{groups.emval}</em>);
    }
    last = start + m[0].length;
  }
  if (last === 0) return paragraph; // no inline tokens — single string node
  if (last < paragraph.length) out.push(paragraph.slice(last));
  return <Fragment>{out}</Fragment>;
}

/** myst-frontmatter author shape is an object; structured-spec emits a bare name
 *  string today. Normalize to `{ name, ...optional }` so the renderer is
 *  one-shape even before the spec grows. */
interface MastheadAuthor {
  name: string;
  orcid?: string;
  email?: string;
  affiliations?: string[];
}

function normalizeAuthors(raw: unknown): MastheadAuthor[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a): MastheadAuthor | null => {
      if (typeof a === 'string') return a.trim() ? { name: a } : null;
      if (a && typeof a === 'object' && typeof (a as any).name === 'string') {
        const obj = a as Record<string, any>;
        return {
          name: obj.name,
          orcid: typeof obj.orcid === 'string' ? obj.orcid : undefined,
          email: typeof obj.email === 'string' ? obj.email : undefined,
          affiliations: Array.isArray(obj.affiliations) ? obj.affiliations : undefined,
        };
      }
      return null;
    })
    .filter((a): a is MastheadAuthor => a !== null);
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
}

/** ORCID canonical URL. Accepts `0000-0000-0000-0000`, `orcid.org/...`,
 *  or a full https URL — returns the https form for the anchor. */
function orcidHref(orcid: string): string {
  if (orcid.startsWith('http')) return orcid;
  if (orcid.startsWith('orcid.org')) return `https://${orcid}`;
  return `https://orcid.org/${orcid}`;
}

export function FiberHeader({ frontmatter, graphNode, historyCount = 0 }: FiberHeaderProps) {
  const name = frontmatter.name ?? frontmatter.title ?? graphNode?.label ?? 'Untitled';
  const authors = normalizeAuthors(frontmatter.authors);
  const keywords = toStringArray(frontmatter.keywords ?? frontmatter.tags);
  const date = typeof frontmatter.date === 'string' ? frontmatter.date : undefined;
  const venue = typeof frontmatter.venue === 'string' ? frontmatter.venue : undefined;
  const doi = typeof frontmatter.doi === 'string' ? frontmatter.doi : undefined;
  const license = typeof frontmatter.license === 'string' ? frontmatter.license : undefined;
  // Felt fibers carry a `outcome:` literal-block scalar. The kanban card
  // surfaces it as the at-a-glance status report; on click-through the
  // deeper FiberPage was dropping it on the floor (the `vellum-fiber-
  // header__lede` slot existed in CSS but FiberHeader.tsx didn't emit it
  // after the Pass-6 preprint refactor). Render it here so the deep view
  // shows the same report the kanban card promised.
  const outcomeRaw = typeof frontmatter.outcome === 'string' ? frontmatter.outcome.trim() : '';
  const outcomeParagraphs = outcomeRaw ? paragraphsFromOutcome(outcomeRaw) : [];

  const hasBelowRule = keywords.length > 0 || date || venue || doi || license;

  return (
    <header className="vellum-fiber-header">
      <h1 className="vellum-fiber-header__title">
        {name}
        {historyCount > 0 && (
          // Komejirushi (`※`, U+203B — the Japanese editorial-note
          // marker) anchors next to the title. Clicking it scrolls the
          // History Card into view via element.scrollIntoView, NOT a
          // hash anchor — `<a href="#history-card">` mutates location.hash,
          // which portolan's hashchange handler interprets as a URL state
          // change it can't parse, falling back to the map and tearing
          // down the vellum overlay. A button + programmatic scroll
          // sidesteps that entirely.
          <button
            type="button"
            className="vellum-fiber-header__history-indicator"
            aria-label={`${historyCount} editorial ${historyCount === 1 ? 'event' : 'events'} — jump to history`}
            title={`${historyCount} editorial ${historyCount === 1 ? 'event' : 'events'} on this fiber`}
            onClick={(e) => {
              e.preventDefault();
              const card = document.getElementById(HISTORY_CARD_ANCHOR_ID);
              card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            <span className="vellum-fiber-header__history-glyph" aria-hidden="true">
              ※
            </span>
            <span className="vellum-fiber-header__history-count" aria-hidden="true">
              {historyCount}
            </span>
          </button>
        )}
      </h1>

      {authors.length > 0 && (
        <div className="vellum-fiber-header__authors" role="list">
          {authors.map((author, i) => (
            <span
              key={`${author.name}-${i}`}
              className="vellum-fiber-header__author"
              role="listitem"
            >
              <span className="vellum-fiber-header__author-name">{author.name}</span>
              {author.orcid && (
                <a
                  className="vellum-fiber-header__orcid"
                  href={orcidHref(author.orcid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`ORCID of ${author.name}`}
                  title={`ORCID ${author.orcid}`}
                >
                  iD
                </a>
              )}
            </span>
          ))}
        </div>
      )}

      {outcomeParagraphs.length > 0 && (
        <section
          className="vellum-fiber-header__lede"
          aria-label="Fiber outcome"
        >
          {outcomeParagraphs.map((p, i) => (
            <p key={i}>{renderInlineOutcome(p)}</p>
          ))}
        </section>
      )}

      {hasBelowRule && (
        <div className="vellum-fiber-header__masthead-meta">
          {keywords.length > 0 && (
            <div className="vellum-fiber-header__keywords">
              {keywords.map((kw) => (
                <span key={kw} className="vellum-fiber-header__keyword">
                  {kw}
                </span>
              ))}
            </div>
          )}
          {(date || venue || doi || license) && (
            <dl className="vellum-fiber-header__pubmeta">
              {date && (
                <>
                  <dt>Date</dt>
                  <dd>{date}</dd>
                </>
              )}
              {venue && (
                <>
                  <dt>Venue</dt>
                  <dd>{venue}</dd>
                </>
              )}
              {doi && (
                <>
                  <dt>DOI</dt>
                  <dd>
                    <a
                      href={doi.startsWith('http') ? doi : `https://doi.org/${doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}
                    </a>
                  </dd>
                </>
              )}
              {license && (
                <>
                  <dt>License</dt>
                  <dd>{license}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      )}
    </header>
  );
}
