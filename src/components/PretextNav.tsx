/**
 * PretextNav — renders navigation items through pretext rich-inline layout.
 *
 * Each nav item becomes a sequence of inline pieces (status glyph + label)
 * separated by " · " dividers. Pretext measures and line-breaks the flow
 * at the available width; each line renders as an absolutely-positioned div
 * with clickable fragment spans.
 */

import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  materializeRichInlineLineRange,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
} from '@chenglou/pretext/rich-inline';

// ───────────────────── Typography ─────────────────────

const MONO = "'IBM Plex Mono', 'JetBrains Mono', 'Courier New', ui-monospace, monospace";
const NAV_SIZE = 11;
const NAV_SIZE_CURRENT = 14;
const GLYPH_SIZE = 9;
const GLYPH_SIZE_CURRENT = 11;
const LINE_HEIGHT = 20;
const NAV_FONT = `500 ${NAV_SIZE}px ${MONO}`;
const NAV_FONT_CURRENT = `600 ${NAV_SIZE_CURRENT}px ${MONO}`;
const GLYPH_FONT = `500 ${GLYPH_SIZE}px ${MONO}`;
const GLYPH_FONT_CURRENT = `600 ${GLYPH_SIZE_CURRENT}px ${MONO}`;
const SEP_FONT = `400 ${NAV_SIZE}px ${MONO}`;

// ───────────────────── Types ─────────────────────

export interface NavItem {
  label: string;
  slug: string;
  isCurrent?: boolean;
  statusGlyph?: string;
}

interface NavPiece {
  text: string;
  font: string;
  breakMode: 'normal' | 'never';
  className: string;
  /** null for separator pieces, slug string for clickable items */
  slug: string | null;
  /**
   * Purely decorative pieces (status glyph, inter-piece spaces) stay
   * clickable visually but are hidden from the a11y tree — otherwise
   * every fiber renders as two separate 'link' nodes (glyph + label).
   * Only the label piece carries role="link".
   */
  decorative: boolean;
}

interface NavLineFragment {
  leadingGap: number;
  text: string;
  className: string;
  slug: string | null;
  decorative: boolean;
}

interface NavLine {
  top: number;
  fragments: NavLineFragment[];
}

// ───────────────────── Piece building ─────────────────────

function buildNavPieces(items: NavItem[]): NavPiece[] {
  const pieces: NavPiece[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const cls = item.isCurrent ? 'pretext-nav-frag--current' : 'pretext-nav-frag';
    const glyphCls = item.isCurrent ? 'pretext-nav-glyph pretext-nav-glyph--current' : 'pretext-nav-glyph';
    const labelFont = item.isCurrent ? NAV_FONT_CURRENT : NAV_FONT;
    const glyphFont = item.isCurrent ? GLYPH_FONT_CURRENT : GLYPH_FONT;

    // Status glyph (smaller font, no-break with label)
    if (item.statusGlyph) {
      pieces.push({
        text: item.statusGlyph,
        font: glyphFont,
        breakMode: 'never',
        className: glyphCls,
        slug: item.slug,
        decorative: true,
      });
      // Space between glyph and label — never break here
      pieces.push({
        text: ' ',
        font: labelFont,
        breakMode: 'never',
        className: cls,
        slug: item.slug,
        decorative: true,
      });
    }

    // Label text — the single a11y-visible link for this item
    pieces.push({
      text: item.label,
      font: labelFont,
      breakMode: 'normal',
      className: cls,
      slug: item.slug,
      decorative: false,
    });

    // Separator between items (not after the last one)
    if (i < items.length - 1) {
      pieces.push({
        text: ' \u00b7 ',
        font: SEP_FONT,
        breakMode: 'normal',
        className: 'pretext-nav-sep',
        slug: null,
        decorative: false,
      });
    }
  }
  return pieces;
}

// ───────────────────── Layout ─────────────────────

function layoutNav(
  flow: PreparedRichInline,
  pieces: NavPiece[],
  width: number,
): { lines: NavLine[]; totalHeight: number } {
  const lines: NavLine[] = [];
  let lineIndex = 0;

  walkRichInlineLineRanges(flow, width, (range) => {
    const materialized = materializeRichInlineLineRange(flow, range);
    const fragments: NavLineFragment[] = materialized.fragments.map((frag) => {
      const piece = pieces[frag.itemIndex];
      return {
        leadingGap: frag.gapBefore,
        text: frag.text,
        className: piece?.className ?? 'pretext-nav-frag',
        slug: piece?.slug ?? null,
        decorative: piece?.decorative ?? false,
      };
    });
    lines.push({
      top: lineIndex * LINE_HEIGHT,
      fragments,
    });
    lineIndex++;
  });

  if (lineIndex === 0) lineIndex = 1;
  return { lines, totalHeight: lineIndex * LINE_HEIGHT };
}

// ───────────────────── Component ─────────────────────

interface PretextNavProps {
  items: NavItem[];
  width: number;
  onNavigate: (slug: string) => void;
}

export function PretextNav({ items, width: _width, onNavigate }: PretextNavProps) {
  const pieces = useMemo(() => buildNavPieces(items), [items]);

  // Scroll the current item into the centre of its scrollable parent
  // whenever the current changes. The scrollable ancestor is the
  // host's `thumb-index__nav-scroll` wrapper (or any other container
  // with `overflow-x: auto`), which `scrollIntoView` finds via its
  // `inline: 'center'` traversal. Without this, clicking a child far
  // to the right lands the user on a fresh page where the current
  // item is highlighted in red but sits offscreen — the user has no
  // visual cue for "where am I in the row," so the highlight is moot.
  const currentRef = useRef<HTMLSpanElement | null>(null);
  const currentSlug = useMemo(
    () => items.find((i) => i.isCurrent)?.slug ?? null,
    [items],
  );
  useEffect(() => {
    if (!currentSlug || !currentRef.current) return;
    currentRef.current.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [currentSlug]);

  const flow = useMemo(
    () =>
      prepareRichInline(
        pieces.map((p) => ({
          text: p.text,
          font: p.font,
          break: p.breakMode,
          extraWidth: 0,
        })),
      ),
    [pieces],
  );

  // Layout at a very wide width so pretext never line-breaks — we want
  // a single horizontal strip that scrolls, not wrapped lines.
  const { lines } = useMemo(
    () => layoutNav(flow, pieces, 100000),
    [flow, pieces],
  );

  if (items.length === 0) return null;

  // Single scrollable line — no wrapping. Pretext measures the text
  // but we render as one horizontal strip with overflow-x: auto.
  // Use the first (and only) line's fragments from a very wide layout
  // so pretext never breaks.
  const singleLine = lines.length > 0
    ? lines.flatMap((l) => l.fragments)
    : [];

  return (
    <div className="pretext-nav">
      <div
        className="pretext-nav-line"
        style={{
          height: LINE_HEIGHT,
          lineHeight: `${LINE_HEIGHT}px`,
          whiteSpace: 'nowrap',
        }}
      >
        {singleLine.map((frag, fragIdx) => {
          const style: CSSProperties = {
            display: 'inline',
            marginLeft: frag.leadingGap,
            whiteSpace: 'pre',
            cursor: frag.slug != null ? 'pointer' : undefined,
          };
          if (frag.slug != null) {
            // Decorative pieces (status glyph, inter-piece spaces) stay
            // visually clickable but are hidden from the a11y tree —
            // otherwise every item renders as two separate 'link' nodes.
            if (frag.decorative) {
              return (
                <span
                  key={fragIdx}
                  className={frag.className}
                  style={style}
                  aria-hidden="true"
                  onClick={() => onNavigate(frag.slug!)}
                >
                  {frag.text}
                </span>
              );
            }
            // Tag the current item's label fragment so the scroll
            // effect can centre it. We use `--current` className as
            // the marker (set by buildNavPieces from `isCurrent`)
            // since the fragments don't carry a flat `isCurrent` flag.
            const isCurrentLabel = frag.className === 'pretext-nav-frag--current';
            return (
              <span
                key={fragIdx}
                ref={isCurrentLabel ? currentRef : undefined}
                className={frag.className}
                style={style}
                role="link"
                tabIndex={0}
                onClick={() => onNavigate(frag.slug!)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onNavigate(frag.slug!);
                }}
              >
                {frag.text}
              </span>
            );
          }
          // Separator pieces (slug == null) are visual punctuation — the
          // " · " divider between sibling labels. Hide from AT so screen
          // readers don't read "middle dot" between every two siblings.
          return (
            <span
              key={fragIdx}
              className={frag.className}
              style={style}
              aria-hidden="true"
            >
              {frag.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
