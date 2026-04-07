/**
 * ColumnHeader — search + mode tabs, inside the prose column.
 *
 * Not a full-width app bar. Lives in the document flow at prose-width,
 * sticks as you scroll. Part of the surface, not chrome.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate } from '@remix-run/react';
import { useMode, type Mode } from '~/contexts/ModeContext';
import type { SearchHit } from '~/utils/content-server';

/** Is the user currently typing into a focusable text element? */
function isFocusedOnInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = (el as HTMLElement).tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'narrative', label: 'Narrative' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'map', label: 'Map' },
  { id: 'delta', label: 'Delta' },
];

const STATUS_GLYPHS: Record<string, string> = {
  open: '○', active: '◐', closed: '●', suspended: '·',
  resolved: '●', suspicious: '◈', blocked: '✕',
};

export function ColumnHeader({ deltaCount = 0 }: { deltaCount?: number }) {
  const { mode, setMode } = useMode();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch search results with debounce
  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.hits ?? []);
          setShowResults(true);
          setSelectedIdx(-1);
        }
      } catch {
        setResults([]);
      }
    }, 200);
  }, []);

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    doSearch(q);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setShowResults(false);
      setQuery('');
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (!showResults || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[selectedIdx >= 0 ? selectedIdx : 0];
      if (hit) {
        setShowResults(false);
        setQuery('');
        navigate(`/${hit.id}`);
      }
    }
  }

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // '/' focuses the search input when the user isn't already typing somewhere
  useEffect(() => {
    function handleSlash(e: KeyboardEvent) {
      if (e.key === '/' && !isFocusedOnInput()) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleSlash);
    return () => document.removeEventListener('keydown', handleSlash);
  }, []);

  return (
    <div className="vellum-column-header">
      <div className="vellum-column-header__row">
        <Link to="/" className="vellum-column-header__wordmark">Vellum</Link>
        <nav className="vellum-column-header__tabs" aria-label="View mode">
          {MODES.map(({ id, label }) => (
            <button
              key={id}
              className={`vellum-mode-tab${mode === id ? ' vellum-mode-tab--active' : ''}`}
              onClick={() => setMode(id)}
              aria-current={mode === id ? 'true' : undefined}
            >
              {label}
              {id === 'delta' && deltaCount > 0 && (
                <span className="vellum-mode-tab__badge">{deltaCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="vellum-column-header__search" ref={searchRef}>
          <span className="vellum-column-header__search-icon">⌕</span>
          <input
            ref={inputRef}
            type="search"
            placeholder="Search fibers…"
            value={query}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={() => query && results.length > 0 && setShowResults(true)}
            aria-label="Search fibers"
          />

          {showResults && results.length > 0 && (
            <div className="search-results">
              {results.slice(0, 12).map((hit, i) => (
                <a
                  key={hit.id}
                  href={`/${hit.id}`}
                  className={`search-result${i === selectedIdx ? ' search-result--selected' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setShowResults(false);
                    setQuery('');
                    navigate(`/${hit.id}`);
                  }}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  <span className="search-result__glyph">
                    {STATUS_GLYPHS[hit.status] ?? '○'}
                  </span>
                  <span className="search-result__body">
                    <span className="search-result__title">{hit.title}</span>
                    {hit.outcome && (
                      <span className="search-result__outcome">{hit.outcome}</span>
                    )}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
