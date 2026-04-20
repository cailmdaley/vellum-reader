/**
 * BibliographySection — References list for the ASTRA appendix.
 *
 * Pass 5 step 1 of the themes constitution: harvest unique DOIs from
 * `node.findings[].evidence[].doi` (both new-knowledge findings and
 * prior_insights carry DOIs this way) and render a single References
 * section, sorted by author-year. Metadata comes from mystra's
 * `/doi-metadata/:doi` endpoint, which is populated from the CrossRef
 * resolver that already runs at load time on the server side.
 *
 * Inline cite chips in prose are out of scope here; that half needs
 * parser-level work (cite role recognition) and belongs with the
 * pretext inline-island refactor. This step ships the bibliography
 * surface so a reader can see what a fiber cites without opening
 * every evidence popover.
 */

import { useEffect, useState } from 'react';
import type { GraphNode } from '~/utils/content-types';

interface DoiMetadata {
  doi: string;
  label?: string;
  authors?: string;
  authorShort?: string;
  year?: string;
  title?: string;
  journal?: string;
}

interface BibliographySectionProps {
  node?: GraphNode;
}

function harvestDois(node: GraphNode): string[] {
  const seen = new Set<string>();
  for (const finding of node.findings ?? []) {
    for (const ev of finding.evidence ?? []) {
      if (ev.doi) seen.add(ev.doi);
    }
  }
  return Array.from(seen).sort();
}

/**
 * CrossRef returns titles with inline HTML (e.g. `<i>Planck</i>`) and
 * encoded entities (e.g. `&amp;`). Strip tags and decode entities so the
 * title reads as plain text in the bibliography list. Kept minimal — a
 * full HTML parse is overkill; a DOMParser roundtrip handles both cases.
 */
function cleanTitle(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  return (doc.body.textContent ?? raw).replace(/\s+/g, ' ').trim();
}

async function fetchMetadata(doi: string): Promise<DoiMetadata> {
  try {
    const res = await fetch(`/doi-metadata/${encodeURIComponent(doi)}`);
    if (!res.ok) return { doi };
    return (await res.json()) as DoiMetadata;
  } catch {
    return { doi };
  }
}

export function BibliographySection({ node }: BibliographySectionProps) {
  const dois = node ? harvestDois(node) : [];
  const [entries, setEntries] = useState<DoiMetadata[]>([]);

  useEffect(() => {
    if (dois.length === 0) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    Promise.all(dois.map(fetchMetadata)).then((metas) => {
      if (cancelled) return;
      // Stable sort: authorShort, then year, then doi.
      metas.sort((a, b) => {
        const as = (a.authorShort ?? a.label ?? a.doi).toLowerCase();
        const bs = (b.authorShort ?? b.label ?? b.doi).toLowerCase();
        if (as !== bs) return as < bs ? -1 : 1;
        return (a.year ?? '').localeCompare(b.year ?? '');
      });
      setEntries(metas);
    });
    return () => {
      cancelled = true;
    };
  }, [dois.join('|')]);

  if (dois.length === 0) return null;

  return (
    <section
      id="astra-appendix-references"
      className="astra-appendix__section"
    >
      <h3 className="astra-appendix__heading">
        References <span className="astra-appendix__count">{dois.length}</span>
      </h3>
      <ol className="astra-bibliography">
        {entries.map((entry) => (
          <li key={entry.doi} className="astra-bibliography__item">
            {entry.authorShort && (
              <span className="astra-bibliography__authors">
                {entry.authorShort}
              </span>
            )}
            {entry.year && (
              <span className="astra-bibliography__year">
                {' '}({entry.year})
              </span>
            )}
            {entry.title && (
              <>
                {'. '}
                <span className="astra-bibliography__title">
                  {cleanTitle(entry.title)}
                </span>
              </>
            )}
            {entry.journal && (
              <span className="astra-bibliography__journal">
                . <em>{cleanTitle(entry.journal)}</em>
              </span>
            )}
            {'. '}
            <a
              className="astra-bibliography__doi"
              href={`https://doi.org/${entry.doi}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {entry.doi}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
