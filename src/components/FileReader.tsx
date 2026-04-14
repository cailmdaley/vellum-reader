/**
 * FileReader — renders a `FileContent` payload as read-only prose or code.
 *
 * Vellum's read surface for arbitrary project files. The host supplies content
 * via `adapter.getFile(path)` and hands the resulting `FileContent` here.
 * Kinds are dispatched to distinct renderers:
 *
 *   - `text`/`markdown` — CodeMirror editor, readonly, language-selected from
 *     `FileContent.language`. Markdown bodies currently display as source; a
 *     myst-rendered mode is a follow-up (will re-use myst-to-react like the
 *     fiber reader).
 *   - `image` — <img src={url}>.
 *   - `html` — <iframe src={url}> in a sandboxed frame.
 *   - `pdf` — all pages rendered to canvas via pdfjs-dist, lazy-loaded on
 *     first use so lightcone (fiber-only) does not pay for it.
 *
 * PDF worker note: vellum resolves the worker URL via
 * `pdfjs-dist/build/pdf.worker.min.mjs?url`, which relies on a Vite-style
 * `?url` asset import. Non-Vite hosts will need to supply their own
 * `GlobalWorkerOptions.workerSrc` before mounting.
 *
 * This is the read half of the portolan FileViewerModal absorption. Editing,
 * annotations, and vim keymap are deliberately NOT here yet — they follow
 * once the read path is proven.
 */

import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from '@codemirror/view';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html as htmlLang } from '@codemirror/lang-html';
import type { FileContent } from '../utils/content-types';

export interface FileReaderProps {
  file: FileContent;
}

function languageExtension(lang: string): Extension | null {
  switch (lang) {
    case 'javascript':
    case 'typescript':
    case 'jsx':
    case 'tsx':
      return javascript({ jsx: lang === 'jsx' || lang === 'tsx', typescript: lang.startsWith('t') });
    case 'python':
      return python();
    case 'markdown':
      return markdown();
    case 'json':
      return json();
    case 'css':
      return css();
    case 'html':
      return htmlLang();
    default:
      return null;
  }
}

function TextReader({ file }: FileReaderProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.theme({
        '&': { height: '100%', fontSize: '14px' },
        '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ];
    const langExt = languageExtension(file.language);
    if (langExt) extensions.push(langExt);

    const state = EditorState.create({ doc: file.content, extensions });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [file.path, file.content, file.language]);

  return <div ref={hostRef} className="vellum-file-reader vellum-file-reader--text" />;
}

function ImageReader({ file }: FileReaderProps) {
  return (
    <div className="vellum-file-reader vellum-file-reader--image">
      <img src={file.url} alt={file.path} />
    </div>
  );
}

function HtmlReader({ file }: FileReaderProps) {
  return (
    <iframe
      className="vellum-file-reader vellum-file-reader--html"
      src={file.url}
      sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
      title={file.path}
    />
  );
}

type PdfJsModule = typeof import('pdfjs-dist');
let pdfJsPromise: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    pdfJsPromise = (async () => {
      const [pdfjs, workerUrlMod] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      const workerSrc = (workerUrlMod as { default: string }).default;
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      }
      return pdfjs;
    })();
  }
  return pdfJsPromise;
}

function PdfReader({ file }: FileReaderProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current || !file.url) return;
    const container = hostRef.current;
    container.innerHTML = '';
    let cancelled = false;
    let loadingTask: { destroy: () => void } | null = null;

    (async () => {
      const pdfjs = await loadPdfJs();
      if (cancelled) return;
      const task = pdfjs.getDocument(file.url!);
      loadingTask = task;
      const doc = await task.promise;
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const containerWidth = container.clientWidth || 800;
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) break;
        const page = await doc.getPage(i);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = (containerWidth * dpr) / unscaledViewport.width;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.display = 'block';
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      }
    })().catch((err) => {
      if (cancelled) return;
      const msg = err instanceof Error ? err.message : String(err);
      const errEl = document.createElement('div');
      errEl.className = 'vellum-file-reader--pdf-error';
      errEl.textContent = `Failed to render PDF: ${msg}`;
      container.appendChild(errEl);
    });

    return () => {
      cancelled = true;
      try {
        loadingTask?.destroy();
      } catch {}
      container.innerHTML = '';
    };
  }, [file.url]);

  if (!file.url) {
    return (
      <div className="vellum-file-reader vellum-file-reader--pdf">
        <p>No URL supplied for {file.path}.</p>
      </div>
    );
  }
  return <div ref={hostRef} className="vellum-file-reader vellum-file-reader--pdf" />;
}

export function FileReader({ file }: FileReaderProps) {
  switch (file.kind) {
    case 'image':
      return <ImageReader file={file} />;
    case 'html':
      return <HtmlReader file={file} />;
    case 'pdf':
      return <PdfReader file={file} />;
    case 'text':
    case 'markdown':
    default:
      return <TextReader file={file} />;
  }
}
