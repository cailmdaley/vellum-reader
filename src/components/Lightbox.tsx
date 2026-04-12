import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Annotation, GraphLink, GraphNode } from '~/utils/content-types';
import { createAnnotation, deleteAnnotation, getAnnotations, updateAnnotation } from '~/api';

export interface LightboxImage {
  src: string;
  alt: string;
  fiberSlug?: string;
}

export interface ImageMarker {
  id: string;
  x: number;
  y: number;
  comment: string;
}

function imageKey(src: string): string {
  try {
    return new URL(src).pathname;
  } catch {
    return src;
  }
}

function annotationToMarker(ann: Annotation): ImageMarker {
  return { id: ann.id, x: ann.x ?? 0, y: ann.y ?? 0, comment: ann.comment };
}

interface LightboxProps {
  images: LightboxImage[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  graphNodes?: GraphNode[];
  graphLinks?: GraphLink[];
  onNavigateToFiber?: (slug: string) => void;
}

export function Lightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
  graphNodes,
  graphLinks,
  onNavigateToFiber,
}: LightboxProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const [markers, setMarkers] = useState<ImageMarker[]>([]);
  const [pendingMark, setPendingMark] = useState<{ x: number; y: number } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [saving, setSaving] = useState(false);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);

  const image = images[currentIndex];
  const hasMultiple = images.length > 1;

  const traceability = useMemo(() => {
    if (!image?.fiberSlug || !graphNodes?.length) return null;
    const node = graphNodes.find((graphNode) => graphNode.slug === image.fiberSlug);
    if (!node) return null;

    const upstream = (graphLinks ?? [])
      .filter((link) => link.target === node.id && link.kind === 'data-flow')
      .map((link) => graphNodes.find((graphNode) => graphNode.id === link.source))
      .filter((graphNode): graphNode is GraphNode => !!graphNode);

    if (!node.hasASTRA && upstream.length === 0) return null;
    return { node, upstream };
  }, [image?.fiberSlug, graphNodes, graphLinks]);

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
      if (pendingMark || activeMarkerId) return;

      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(currentIndex - 1);
      else if (e.key === 'ArrowRight' && currentIndex < images.length - 1) onNavigate(currentIndex + 1);
    }

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [currentIndex, images.length, onClose, onNavigate, pendingMark, activeMarkerId]);

  useEffect(() => {
    const currentImage = images[currentIndex];
    setPendingMark(null);
    setActiveMarkerId(null);
    setEditingComment(null);
    setMarkers([]);
    if (!currentImage?.fiberSlug) return;

    const src = imageKey(currentImage.src);
    let cancelled = false;
    getAnnotations(currentImage.fiberSlug, { kind: 'image', imageSrc: src }).then((anns) => {
      if (!cancelled) setMarkers(anns.map(annotationToMarker));
    });
    return () => {
      cancelled = true;
    };
  }, [currentIndex, images]);

  useEffect(() => {
    if (pendingMark && commentRef.current) commentRef.current.focus();
  }, [pendingMark]);

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

  const saveMarker = useCallback(async () => {
    if (!pendingMark || !commentText.trim() || !image?.fiberSlug) return;
    setSaving(true);
    try {
      const ann = await createAnnotation({
        slug: image.fiberSlug,
        kind: 'image',
        x: pendingMark.x,
        y: pendingMark.y,
        imageSrc: imageKey(image.src),
        comment: commentText.trim(),
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
      });
      if (ann) setMarkers((prev) => [...prev, annotationToMarker(ann)]);
    } finally {
      setSaving(false);
      setPendingMark(null);
      setCommentText('');
    }
  }, [pendingMark, commentText, image]);

  const handleDeleteMarker = useCallback(async (id: string) => {
    const ok = await deleteAnnotation(id);
    if (ok) {
      setMarkers((prev) => prev.filter((marker) => marker.id !== id));
      if (activeMarkerId === id) {
        setActiveMarkerId(null);
        setEditingComment(null);
      }
    }
  }, [activeMarkerId]);

  const handleSaveEdit = useCallback(async (id: string) => {
    if (editingComment === null) return;
    const ann = await updateAnnotation(id, editingComment.trim());
    if (ann) setMarkers((prev) => prev.map((marker) => (marker.id === id ? { ...marker, comment: ann.comment } : marker)));
    setEditingComment(null);
    setActiveMarkerId(null);
  }, [editingComment]);

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

  return (
    <div className="vellum-lightbox" onClick={handleBackdropClick}>
      <button className="vellum-lightbox__close" onClick={onClose} aria-label="Close">
        &times;
      </button>

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

      <div className="vellum-lightbox__media">
        <img
          ref={imgRef}
          src={image.src}
          alt={image.alt}
          className="vellum-lightbox__image"
          onClick={handleImageClick}
          draggable={false}
        />

        {markers.map((marker, index) => (
          <span
            key={marker.id}
            className={`vellum-lightbox__marker${activeMarkerId === marker.id ? ' vellum-lightbox__marker--active' : ''}`}
            style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
            title={marker.comment}
            onClick={(e) => {
              e.stopPropagation();
              if (activeMarkerId === marker.id) {
                setActiveMarkerId(null);
                setEditingComment(null);
              } else {
                setActiveMarkerId(marker.id);
                setEditingComment(null);
                setPendingMark(null);
              }
            }}
          >
            {index + 1}
            {activeMarkerId === marker.id && (
              <div className="vellum-lightbox__marker-popover" onClick={(e) => e.stopPropagation()}>
                <button
                  className="vellum-lightbox__marker-popover-close"
                  onClick={() => {
                    setActiveMarkerId(null);
                    setEditingComment(null);
                  }}
                  aria-label="Close popover"
                >
                  &times;
                </button>
                {editingComment !== null ? (
                  <>
                    <textarea
                      className="vellum-lightbox__marker-popover-edit"
                      value={editingComment}
                      onChange={(e) => setEditingComment(e.target.value)}
                      rows={3}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleSaveEdit(marker.id);
                        }
                        if (e.key === 'Escape') setEditingComment(null);
                      }}
                    />
                    <div className="vellum-lightbox__marker-popover-actions">
                      <button onClick={() => void handleSaveEdit(marker.id)}>Save</button>
                      <button onClick={() => setEditingComment(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="vellum-lightbox__marker-popover-comment">{marker.comment || <em>No comment</em>}</p>
                    <div className="vellum-lightbox__marker-popover-actions">
                      <button onClick={() => setEditingComment(marker.comment)}>Edit</button>
                      <button className="vellum-lightbox__marker-popover-delete" onClick={() => void handleDeleteMarker(marker.id)}>
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </span>
        ))}

        {pendingMark && (
          <span
            className="vellum-lightbox__marker vellum-lightbox__marker--pending"
            style={{ left: `${pendingMark.x}%`, top: `${pendingMark.y}%` }}
          >
            ?
          </span>
        )}
      </div>

      {pendingMark && (
        <div className="vellum-lightbox__annotate">
          <textarea
            ref={commentRef}
            className="vellum-lightbox__annotate-input"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Annotate this point..."
            rows={3}
            onKeyDown={(e) => {
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

      {hasMultiple && <div className="vellum-lightbox__counter">{currentIndex + 1} / {images.length}</div>}
      {image.alt && <div className="vellum-lightbox__caption">{image.alt}</div>}

      {markers.length > 0 && (
        <div className="vellum-lightbox__annotations">
          {markers.map((marker, index) => (
            <div
              key={marker.id}
              className={`vellum-lightbox__annotation-item${activeMarkerId === marker.id ? ' vellum-lightbox__annotation-item--active' : ''}`}
              onClick={() => {
                setActiveMarkerId(marker.id);
                setEditingComment(null);
                setPendingMark(null);
              }}
            >
              <span className="vellum-lightbox__annotation-num">{index + 1}</span>
              <span>{marker.comment}</span>
              <button
                className="vellum-lightbox__annotation-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDeleteMarker(marker.id);
                }}
                title="Remove annotation"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {traceability && (
        <div className="vellum-lightbox__trace">
          <button className="vellum-lightbox__trace-toggle" onClick={() => setTraceExpanded((prev) => !prev)}>
            <span className="vellum-lightbox__trace-glyph">{traceability.node.hasASTRA ? '⧖' : '○'}</span>
            <span className="vellum-lightbox__trace-title">{traceability.node.label}</span>
            {traceability.node.hasASTRA && (
              <span className="vellum-lightbox__trace-badge">
                {(traceability.node.decisionCount ?? 0) > 0 && `${traceability.node.decisionCount}d`}
                {(traceability.node.decisionCount ?? 0) > 0 && (traceability.node.findingCount ?? 0) > 0 && ' '}
                {(traceability.node.findingCount ?? 0) > 0 && `${traceability.node.findingCount}f`}
              </span>
            )}
            <span className="vellum-lightbox__trace-chevron">{traceExpanded ? '▾' : '▸'}</span>
          </button>

          {traceExpanded && (
            <div className="vellum-lightbox__trace-detail">
              {traceability.upstream.length > 0 && (
                <div className="vellum-lightbox__trace-section">
                  <span className="vellum-lightbox__trace-label">inputs</span>
                  {traceability.upstream.map((dep) => (
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

              {(traceability.node.decisions?.length ?? 0) > 0 && (
                <div className="vellum-lightbox__trace-section">
                  <span className="vellum-lightbox__trace-label">decisions</span>
                  {traceability.node.decisions!.map((decision) => (
                    <div key={decision.key} className="vellum-lightbox__trace-decision">
                      <span className="vellum-lightbox__trace-decision-glyph">⧖</span>
                      <span>{decision.label}</span>
                      {decision.selectedLabel && (
                        <span className="vellum-lightbox__trace-decision-selected">→ {decision.selectedLabel}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(traceability.node.findings?.length ?? 0) > 0 && (
                <div className="vellum-lightbox__trace-section">
                  <span className="vellum-lightbox__trace-label">findings</span>
                  {traceability.node.findings!.map((finding) => (
                    <div key={finding.key} className="vellum-lightbox__trace-finding">
                      {finding.hasEvidence && <span className="vellum-lightbox__trace-evidence-dot">●</span>}
                      <span>{finding.claim}</span>
                    </div>
                  ))}
                </div>
              )}

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
