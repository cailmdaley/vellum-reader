/**
 * FigureGallery — section-end grid of figures for a fiber.
 *
 * Pass 9b step 6. Walks the current graph node's outputs + finding evidence
 * via `collectFigures(node)` and renders each as a thumbnail + caption
 * card. Click opens the lightbox with the full gallery carousel so the
 * reader can page through every figure without leaving the fiber.
 *
 * Gated on `theme.layout.figureGallery === 'section-end'`. After
 * `lightcone-margin` retired in vellum-reader/vellum-native-astra-renderer,
 * no surviving theme ships `'section-end'` (both `cail-personal` and
 * `lightcone-linear` opt out — see theme configs); the component is kept
 * as a reusable primitive for future themes that want a section-end grid.
 *
 * Mounted inside the prose article, immediately after `AstraAppendix`.
 * Empty fibers (no figures collected) render nothing.
 */

import type { GraphNode } from '~/utils/content-types';
import { collectFigures, type CollectedFigure } from '~/utils/collect-figures';
import type { LightboxImage } from './Lightbox';

interface FigureGalleryProps {
  node?: GraphNode;
}

function figureLightboxImage(fig: CollectedFigure, host?: GraphNode): LightboxImage {
  // Output-hosted figures carry provenance (recipe, from, inputs) that the
  // Lightbox side panel can render. Finding-hosted figures don't have a
  // first-class output-kind provenance, so we pass the bare image + host
  // reference and the Lightbox shows the image alone.
  if (fig.host.kind === 'output') {
    return {
      src: fig.src,
      alt: fig.alt,
      fiberSlug: host?.slug,
      output: fig.host.output,
      hostNode: host,
    };
  }
  return {
    src: fig.src,
    alt: fig.alt,
    fiberSlug: host?.slug,
    hostNode: host,
  };
}

export function FigureGallery({ node }: FigureGalleryProps) {
  if (!node) return null;
  const figures = collectFigures(node);
  if (figures.length === 0) return null;

  const images = figures.map((fig) => figureLightboxImage(fig, node));

  const openAt = (index: number) => {
    document.dispatchEvent(
      new CustomEvent('vellum:open-lightbox', {
        detail: { images, index },
      }),
    );
  };

  return (
    <aside
      id="astra-figure-gallery"
      className="astra-figure-gallery"
      aria-label="Figures"
    >
      <div className="astra-figure-gallery__divider">
        <span className="astra-figure-gallery__divider-label">figures</span>
        <span className="astra-figure-gallery__count">{figures.length}</span>
      </div>
      <div className="astra-figure-gallery__grid">
        {figures.map((fig, i) => {
          // Anchor IDs mirror AstraAppendix/FiberHeader so cross-refs from
          // the prose can target a gallery tile directly if needed later.
          const anchorId =
            fig.host.kind === 'output'
              ? `astra-figure-output-${fig.host.id}`
              : `astra-figure-finding-${fig.host.key}-${fig.host.evidenceId}`;
          return (
            <button
              key={anchorId}
              id={anchorId}
              type="button"
              className="astra-figure-gallery__tile"
              onClick={() => openAt(i)}
              aria-label={`Open figure: ${fig.label}`}
            >
              <span className="astra-figure-gallery__thumb">
                <img src={fig.src} alt={fig.alt} loading="lazy" />
              </span>
              <span className="astra-figure-gallery__caption">
                <span className="astra-figure-gallery__label">{fig.label}</span>
                {fig.caption && (
                  <span className="astra-figure-gallery__desc">{fig.caption}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
