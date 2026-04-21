/**
 * FiberHeader — preprint-style masthead for a fiber / analysis page.
 *
 * Pass 6 (themes-constitution): the biggest single "feels like a real paper"
 * cue. The cartouche — title with an ornamented rule below — already lived
 * here. This pass adds an author row beneath the title and a keyword row
 * beneath the rule, drawing on whatever the frontmatter carries.
 *
 * The astra-spec today carries `name`, `authors: string[]`, and `tags:
 * string[]`. mystra threads them onto `PageFrontmatter` (see
 * mystra/src/transform/render-astra-project.ts). When the spec grows richer
 * fields (affiliations, ORCID, DOI, date, venue, license, funding) the
 * masthead reads them through the same permissive `frontmatter` bag and
 * renders them without further wiring. Missing fields degrade to absence,
 * not "Untitled"-style placeholders — the masthead shows only what's real.
 *
 * Theme-agnostic. Same masthead renders under lightcone-linear,
 * lightcone-margin, and cail-personal. Per-theme typographic variation
 * happens through the shared CSS custom properties (`--ink`, fonts, etc).
 */

import type { GraphNode } from '~/utils/content-types';

interface FiberHeaderProps {
  frontmatter: Record<string, any>;
  graphNode?: GraphNode;
  lede?: string | null;
}

/** myst-frontmatter author shape is an object; astra-spec emits a bare name
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

export function FiberHeader({ frontmatter, graphNode }: FiberHeaderProps) {
  const name = frontmatter.name ?? frontmatter.title ?? graphNode?.label ?? 'Untitled';
  const authors = normalizeAuthors(frontmatter.authors);
  const keywords = toStringArray(frontmatter.keywords ?? frontmatter.tags);
  const date = typeof frontmatter.date === 'string' ? frontmatter.date : undefined;
  const venue = typeof frontmatter.venue === 'string' ? frontmatter.venue : undefined;
  const doi = typeof frontmatter.doi === 'string' ? frontmatter.doi : undefined;
  const license = typeof frontmatter.license === 'string' ? frontmatter.license : undefined;

  const hasBelowRule = keywords.length > 0 || date || venue || doi || license;

  return (
    <header className="vellum-fiber-header">
      <h1 className="vellum-fiber-header__title">{name}</h1>

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
