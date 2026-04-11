/**
 * Lightbox — full-viewport overlay for evidence artifacts.
 *
 * Opens when the reader clicks an image in the prose. Shows the artifact
 * at full size with a dark backdrop. Arrow keys navigate when multiple
 * images exist. Click the image to place a numbered annotation marker.
 *
 * Traceability chain (when available from ASTRA data):
 *   figure → recipe → inputs → decisions
 * shown in a collapsible panel below the image.
 *
 * Annotation persistence: markers are stored via the mystra annotation API
 * (kind: 'image') keyed by fiber slug + image pathname. They survive page
 * reloads and are shared across sessions (project-local JSON store).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode, GraphLink, Annotation } from '~/utils/content-types';
import {
  createAnnotation,
  deleteAnnotation,
  getAnnotations,
  updateAnnotation,
} from '~/utils/api-client';

export interface LightboxImage {
  src: string;
  alt: string;
  /** Fiber slug, if the image comes from a known fiber */
  fiberSlug?: string;
}

export interface ImageMarker {
  id: string;
  x: number;  // 0–100 (% from left)
  y: number;  // 0–100 (% from top)
  comment: string;
}

/** Stable key for an image — use pathname to avoid host differences between dev/prod */
function imageKey(src: string): string {
  try { return new URL(src).pathname; }
  catch { return src; }
}

/** Convert an API Annotation (image kind) to an ImageMarker. */
function annotationToMarker(ann: Annotation): ImageMarker {
  return { id: ann.id, x: ann.x ?? 0, y: ann.y ?? 0, comment: ann.comment };
}

interface LightboxProps {
  images: LightboxImage[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  /** Graph nodes for traceability chain lookup */
  graphNodes?: GraphNode[];
  /** Graph links for upstream dependency tracing */
  graphLinks?: GraphLink[];
  /** Navigate to a fiber slug (SPA navigation) */
  onNavigateToFiber?: (slug: string) => void;
}

export function Lightbox({ images, currentIndex, onClose, onNavigate, graphNodes, graphLinks, onNavigateToFiber }: LightboxProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [markers, setMarkers] = useState<ImageMarker[]>([]);
  const [pendingMark, setPendingMark] = useState<{ x: number; y: number } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [saving, setSaving] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const [traceExpanded, setTraceExpanded] = useState(false);
  /** Which marker id has an open popover (click-to-inspect). */
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  /** Inline edit text for the popover. */
  const [editingComment, setEditingComment] = useState<string | null>(null);

  const image = images[currentIndex];
  const hasMultiple = images.length > 1;

  // Traceability chain: fiber → upstream deps → decisions
  const traceability = useMemo(() => {
    if (!image?.fiberSlug || !graphNodes?.length) return null;
    const node = graphNodes.find(n => n.slug === image.fiberSlug);
    if (!node) return null;

    // Find upstream dependencies (data-flow links targeting this fiber)
    const upstream = (graphLinks ?? [])
      .filter(l => l.target === node.id && l.kind === 'data-flow')
      .map(l => graphNodes.find(n => n.id === l.source))
      .filter((n): n is GraphNode => !!n);

    // Only show if there's something meaningful (ASTRA data or upstream deps)
    if (!node.hasASTRA && upstream.length === 0) return null;

    return { node, upstream };
  }, [image?.fiberSlug, graphNodes, graphLinks]);

  // Focus management + keyboard
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (activeMarkerId) {
          setActiveMarkerId(null);
          setEditingComment(null);
          e.preventDefault();
          return;
        }
        if (pendingMark) {
          setPendingMark(null);
          e.preventDefault();
          return;
        }
        onClose();
        e.preventDefault();
        return;
      }
      if (pendingMark || activeMarkerId) return; // Don't navigate while annotating

      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        onNavigate(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < images.length - 1) {
        onNavigate(currentIndex + 1);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [currentIndex, images.length, onClose, onNavigate, pendingMark, activeMarkerId]);

  // Load persisted markers from API when image changes
  useEffect(() => {
    const img = images[currentIndex];
    setPendingMark(null);
    setActiveMarkerId(null);
    setEditingComment(null);
    setMarkers([]);
    if (!img) return;
    const slug = img.fiberSlug;
    if (!slug) return; // No fiber slug → can't persist; just show empty
    const src = imageKey(img.src);
    let cancelled = false;
    getAnnotations(slug, { kind: 'image', imageSrc: src }).then(anns => {
      if (!cancelled) setMarkers(anns.map(annotationToMarker));
    });
    return () => { cancelled = true; };
  }, [currentIndex, images]);

  // Auto-focus comment textarea
  useEffect(() => {
    if (pendingMark && commentRef.current) {
      commentRef.current.focus();
    }
  }, [pendingMark]);

  // Click image to place annotation marker (only when no marker is active)
  const handleImageClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (activeMarkerId) {
      setActiveMarkerId(null);
      setEditingComment(null);
      return;
    }
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPendingMark({ x, y });
    setCommentText('');
  }, [activeMarkerId]);

  // Save annotation to API
  const saveMarker = useCallback(async () => {
    if (!pendingMark || !commentText.trim() || !image) return;
    const slug = image.fiberSlug;
    if (!slug) return;
    setSaving(true);
    try {
      const ann = await createAnnotation({
        slug,
        kind: 'image',
        x: pendingMark.x,
        y: pendingMark.y,
        imageSrc: imageKey(image.src),
        comment: commentText.trim(),
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
      });
      if (ann) {
        setMarkers(prev => [...prev, annotationToMarker(ann)]);
      }
    } finally {
      setSaving(false);
      setPendingMark(null);
      setCommentText('');
    }
  }, [pendingMark, commentText, image]);

  // Delete a marker via API
  const handleDeleteMarker = useCallback(async (id: string) => {
    const ok = await deleteAnnotation(id);
    if (ok) {
      setMarkers(prev => prev.filter(m => m.id !== id));
      if (activeMarkerId === id) {
        setActiveMarkerId(null);
        setEditingComment(null);
      }
    }
  }, [activeMarkerId]);

  // Save edited comment via API
  const handleSaveEdit = useCallback(async (id: string) => {
    if (editingComment === null) return;
    const ann = await updateAnnotation(id, editingComment.trim());
    if (ann) {
      setMarkers(prev => prev.map(m => m.id === id ? { ...m, comment: ann.comment } : m));
    }
    setEditingComment(null);
    setActiveMarkerId(null);
  }, [editingComment]);

  // Click backdrop to close (also dismiss active marker)
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('vellum-lightbox')) {
      if (activeMarkerId) {
        setActiveMarkerId(null);
        setEditingComment(null);
        return;
      }
      onClose();
    }
  }, [onClose, activeMarkerId]);

  if (!image) return null;

  const activeMarker = activeMarkerId ? markers.find(m => m.id === activeMarkerId) : null;

  return (
    <div className="vellum-lightbox" onClick={handleBackdropClick}>
      {/* Close button */}
      <button className="vellum-lightbox__close" onClick={onClose} aria-label="Close">
        &times;
      </button>

      {/* Navigation arrows */}
      {hasMultiple && currentIndex > 0 && (
        <button
          className="vellum-lightbox__nav vellum-lightbox__nav--prev"
          onClick={() => onNavigate(currentIndex - 1)}
          aria-label="Previous image"
        >
          &lsaquo;
        </button>
      )}
      {hasMultiple && currentIndex < images.length - 1 && (
        <button
          className="vellum-lightbox__nav vellum-lightbox__nav--next"
          onClick={() => onNavigate(currentIndex + 1)}
          aria-label="Next image"
        >
          &rsaquo;
        </button>
      )}

      {/* Image container with annotation markers */}
      <div className="vellum-lightbox__media">
        <img
          ref={imgRef}
          src={image.src}
          alt={image.alt}
          className="vellum-lightbox__image"
          onClick={handleImageClick}
          draggable={false}
        />

        {/* Saved markers */}
        {markers.map((m, i) => (
          <span
            key={m.id}
            className={`vellum-lightbox__marker${activeMarkerId === m.id ? ' vellum-lightbox__marker--active' : ''}`}
            style={{ left: `${m.x}%`, top: `${m.y}%` }}
            title={m.comment}
            onClick={e => {
              e.stopPropagation();
              if (activeMarkerId === m.id) {
                setActiveMarkerId(null);
                setEditingComment(null);
              } else {
                setActiveMarkerId(m.id);
                setEditingComment(null);
                setPendingMark(null);
              }
            }}
          >
            {i + 1}

            {/* Popover — only on the active marker */}
            {activeMarkerId === m.id && (
              <div
                className="vellum-lightbox__marker-popover"
                onClick={e => e.stopPropagation()}
              >
                <button
                  className="vellum-lightbox__marker-popover-close"
                  onClick={() => { setActiveMarkerId(null); setEditingComment(null); }}
                  aria-label="Close popover"
                >
                  &times;
                </button>
                {editingComment !== null ? (
                  <>
                    <textarea
                      className="vellum-lightbox__marker-popover-edit"
                      value={editingComment}
                      onChange={e => setEditingComment(e.target.value)}
                      rows={3}
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSaveEdit(m.id); }
                        if (e.key === 'Escape') { setEditingComment(null); }
                      }}
                    />
                    <div className="vellum-lightbox__marker-popover-actions">
                      <button onClick={() => void handleSaveEdit(m.id)}>Save</button>
                      <button onClick={() => setEditingComment(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="vellum-lightbox__marker-popover-comment">{m.comment || <em>No comment</em>}</p>
                    <div className="vellum-lightbox__marker-popover-actions">
                      <button onClick={() => setEditingComment(m.comment)}>Edit</button>
                      <button
                        className="vellum-lightbox__marker-popover-delete"
                        onClick={() => void handleDeleteMarker(m.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </span>
        ))}

        {/* Pending marker */}
        {pendingMark && (
          <span
            className="vellum-lightbox__marker vellum-lightbox__marker--pending"
            style={{ left: `${pendingMark.x}%`, top: `${pendingMark.y}%` }}
          >
            ?
          </span>
        )}
      </div>

      {/* Annotation input popover */}
      {pendingMark && (
        <div className="vellum-lightbox__annotate">
          <textarea
            ref={commentRef}
            className="vellum-lightbox__annotate-input"
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            placeholder="Annotate this point..."
            rows={3}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void saveMarker();
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setPendingMark(null);
              }
            }}
          />
          <div className="vellum-lightbox__annotate-actions">
            <button onClick={() => void saveMarker()} disabled={!commentText.trim() || saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setPendingMark(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Position indicator */}
      {hasMultiple && (
        <div className="vellum-lightbox__counter">
          {currentIndex + 1} / {images.length}
        </div>
      )}

      {/* Alt text / caption */}
      {image.alt && (
        <div className="vellum-lightbox__caption">{image.alt}</div>
      )}

      {/* Annotation list */}
      {markers.length > 0 && (
        <div className="vellum-lightbox__annotations">
          {markers.map((m, i) => (
            <div
              key={m.id}
              className={`vellum-lightbox__annotation-item${activeMarkerId === m.id ? ' vellum-lightbox__annotation-item--active' : ''}`}
              onClick={() => {
                setActiveMarkerId(m.id);
                setEditingComment(null);
                setPendingMark(null);
              }}
            >
              <span className="vellum-lightbox__annotation-num">{i + 1}</span>
              <span>{m.comment}</span>
              <button
                className="vellum-lightbox__annotation-delete"
                onClick={e => { e.stopPropagation(); void handleDeleteMarker(m.id); }}
                title="Remove annotation"
              >&times;</button>
            </div>
          ))}
        </div>
      )}

      {/* Traceability chain */}
      {traceability && (
        <div className="vellum-lightbox__trace">
          <button
            className="vellum-lightbox__trace-toggle"
            onClick={() => setTraceExpanded(prev => !prev)}
          >
            <span className="vellum-lightbox__trace-glyph">
              {traceability.node.hasASTRA ? '◇' : '○'}
            </span>
            <span className="vellum-lightbox__trace-title">
              {traceability.node.label}
            </span>
            {traceability.node.hasASTRA && (
              <span className="vellum-lightbox__trace-badge">
                {(traceability.node.decisionCount ?? 0) > 0 && `${traceability.node.decisionCount}d`}
                {(traceability.node.decisionCount ?? 0) > 0 && (traceability.node.findingCount ?? 0) > 0 && ' '}
                {(traceability.node.findingCount ?? 0) > 0 && `${traceability.node.findingCount}f`}
              </span>
            )}
            <span className="vellum-lightbox__trace-chevron">
              {traceExpanded ? '▾' : '▸'}
            </span>
          </button>

          {traceExpanded && (
            <div className="vellum-lightbox__trace-detail">
              {/* Upstream dependencies */}
              {traceability.upstream.length > 0 && (
                <div className="vellum-lightbox__trace-section">
                  <span className="vellum-lightbox__trace-label">inputs</span>
                  {traceability.upstream.map(dep => (
                    <button
                      key={dep.id}
                      className="vellum-lightbox__trace-link"
                      onClick={() => {
                        onClose();
                        onNavigateToFiber?.(dep.slug);
                      }}
                    >
                      {dep.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Decisions */}
              {(traceability.node.decisions?.length ?? 0) > 0 && (
                <div className="vellum-lightbox__trace-section">
                  <span className="vellum-lightbox__trace-label">decisions</span>
                  {traceability.node.decisions!.map(d => (
                    <div key={d.key} className="vellum-lightbox__trace-decision">
                      <span className="vellum-lightbox__trace-decision-glyph">◇</span>
                      <span>{d.label}</span>
                      {d.selectedLabel && (
                        <span className="vellum-lightbox__trace-decision-selected">
                          → {d.selectedLabel}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Findings */}
              {(traceability.node.findings?.length ?? 0) > 0 && (
                <div className="vellum-lightbox__trace-section">
                  <span className="vellum-lightbox__trace-label">findings</span>
                  {traceability.node.findings!.map(f => (
                    <div key={f.key} className="vellum-lightbox__trace-finding">
                      {f.hasEvidence && <span className="vellum-lightbox__trace-evidence-dot">●</span>}
                      <span>{f.claim}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Verdict */}
              {traceability.node.verdict && !traceability.node.findings?.length && (
                <div className="vellum-lightbox__trace-section">
                  <span className="vellum-lightbox__trace-label">verdict</span>
                  <p className="vellum-lightbox__trace-verdict">{traceability.node.verdict}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
