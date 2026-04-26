import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { createLightconeAdapter } from './api';
import { AdapterProvider } from './contexts/AdapterContext';
import { AnnotationActionsProvider } from './contexts/AnnotationActionsContext';
import { ModeProvider } from './contexts/ModeContext';
import type { AnnotationBulkAction } from './utils/content-types';
import 'katex/dist/katex.min.css';
import './vellum.css';

const adapter = createLightconeAdapter();

// Annotation bulk actions surfaced above the fiber masthead. Wired via
// AnnotationActionsProvider so individual hosts (this dev app, portolan,
// future deployments) opt into whichever actions they support without
// the framework baking any of them in.
//
// `import.meta.env.DEV` gates personal-only actions out of the production
// bake so vellum-demos doesn't ship "File as fiber" / "Send to worker"
// surfaces that have no matching backend in that read-only deployment.
// The action handlers run in dev against the local mystra (which has
// /api/file-as-fiber registered when not in --read-only mode).
function composeAnnotationFiberBody(
  sourceSlug: string,
  annotations: AnnotationBulkAction extends never ? never : Array<{
    selectedText?: string;
    contextBefore?: string;
    contextAfter?: string;
    comment: string;
    paragraphIndex?: number;
  }>,
): string {
  // Mirror portolan's saveAnnotationsAsFiber body shape so the resulting
  // fiber reads like a familiar "N notes on X" page: source ref, then
  // numbered sections each with the quoted passage and the comment.
  const sections: string[] = sourceSlug ? [`[[${sourceSlug}]]`, ''] : [];
  for (let i = 0; i < annotations.length; i++) {
    const ann = annotations[i];
    if (annotations.length > 1) {
      sections.push(`## ${i + 1}.`);
    }
    const quoted = ann.selectedText?.trim();
    if (quoted) {
      for (const line of quoted.split('\n')) sections.push(`> ${line}`);
      sections.push('');
    }
    if (ann.comment.trim()) {
      sections.push(ann.comment.trim());
      sections.push('');
    }
  }
  return sections.join('\n').trim();
}

const annotationBulkActions: AnnotationBulkAction[] = import.meta.env.DEV ? [
  {
    id: 'file-as-fiber',
    label: 'File as fiber',
    title: 'Collapse all annotations into one fiber under the source',
    onInvoke: async (annotations, ctx) => {
      const sourceSlug = annotations[0]?.slug ?? '';
      const title = annotations.length === 1
        ? `Note on ${sourceSlug || 'page'}`
        : `${annotations.length} notes on ${sourceSlug || 'page'}`;
      const body = composeAnnotationFiberBody(sourceSlug, annotations);
      try {
        const res = await fetch('/api/file-as-fiber', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceSlug, title, body, kind: 'note' }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) {
              console.error('[file-as-fiber] failed', res.status, result);
          alert(`File as fiber failed: ${result?.error ?? res.status}`);
          return;
        }
          console.log('[file-as-fiber] created', result.fiberId, 'at', result.path);
        ctx.refreshAnnotations();
      } catch (err) {
          console.error('[file-as-fiber] network error', err);
        alert(`File as fiber network error: ${(err as Error).message}`);
      }
    },
  },
] : [];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AdapterProvider adapter={adapter}>
        <AnnotationActionsProvider bulkActions={annotationBulkActions}>
          <ModeProvider>
            <App />
          </ModeProvider>
        </AnnotationActionsProvider>
      </AdapterProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
