/**
 * FileReader — renders a `FileContent` payload as prose or code.
 *
 * Vellum's read surface for arbitrary project files. The host supplies content
 * via `adapter.getFile(path)` and hands the resulting `FileContent` here.
 * Kinds are dispatched to distinct renderers:
 *
 *   - `text`/`markdown` — CodeMirror editor. Readonly by default; pass
 *     `editable` to enable writes. When editable, `onDocChange` fires on every
 *     doc change and `onSave` fires on `Mod-s` / `:w`. Markdown with a parsed
 *     `mdast` tree renders via myst-to-react in readonly mode; editable mode
 *     always uses the CodeMirror source view.
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
 * This is the read + edit surface of the portolan FileViewerModal absorption.
 * Annotations and split markdown preview are deliberately NOT here yet — they
 * follow once the edit path is proven.
 */

import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html as htmlLang } from '@codemirror/lang-html';
import { vim, Vim } from '@replit/codemirror-vim';
import { ArticleProvider, ThemeProvider, mergeRenderers } from '@myst-theme/providers';
import { DEFAULT_RENDERERS, MyST } from 'myst-to-react';
import type { FileContent } from '../utils/content-types';

export interface FileReaderProps {
  file: FileContent;
  /** When true, the text/markdown renderer is a mutable editor (vim + history). */
  editable?: boolean;
  /** Fires on every doc change while `editable`. */
  onDocChange?: (content: string) => void;
  /** Fires on Mod-s and vim `:w` while `editable`. */
  onSave?: () => void;
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

const saveEffect = StateEffect.define<null>();

let vimSaveRegistered = false;
function registerVimSave() {
  if (vimSaveRegistered) return;
  vimSaveRegistered = true;
  Vim.defineEx('write', 'w', (cm: unknown) => {
    const view = (cm as { cm6?: EditorView }).cm6;
    if (!view) return;
    view.dispatch({ effects: saveEffect.of(null) });
  });
}

function TextReader({ file, editable, onDocChange, onSave }: FileReaderProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onDocChangeRef = useRef(onDocChange);
  const onSaveRef = useRef(onSave);
  onDocChangeRef.current = onDocChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return;
    if (editable) registerVimSave();

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '14px' },
        '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ];

    if (editable) {
      extensions.push(
        vim(),
        history(),
        EditorView.lineWrapping,
        EditorState.allowMultipleSelections.of(true),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: 'Mod-s',
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onDocChangeRef.current?.(update.state.doc.toString());
          }
          for (const tr of update.transactions) {
            for (const eff of tr.effects) {
              if (eff.is(saveEffect)) onSaveRef.current?.();
            }
          }
        }),
      );
    } else {
      extensions.push(EditorView.editable.of(false), EditorState.readOnly.of(true));
    }

    const langExt = languageExtension(file.language);
    if (langExt) extensions.push(langExt);

    const state = EditorState.create({ doc: file.content, extensions });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [file.path, file.content, file.language, editable]);

  return (
    <div
      ref={hostRef}
      className={`vellum-file-reader vellum-file-reader--text${editable ? ' vellum-file-reader--editable' : ''}`}
    />
  );
}

const MARKDOWN_RENDERERS = mergeRenderers([DEFAULT_RENDERERS], true);

function MarkdownReader({ file }: FileReaderProps) {
  // Standalone markdown bodies do not come with a ThemeProvider in scope (the
  // portolan seam only wraps AdapterProvider). We install one here so MyST can
  // resolve its renderer context without the host app having to opt in.
  return (
    <ThemeProvider theme={null} setTheme={() => {}} renderers={MARKDOWN_RENDERERS}>
      <ArticleProvider
        kind={'Article' as any}
        frontmatter={{} as any}
        references={{ cite: {}, footnotes: {} } as any}
      >
        <div className="vellum-file-reader vellum-file-reader--markdown">
          <MyST ast={file.mdast} />
        </div>
      </ArticleProvider>
    </ThemeProvider>
  );
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

export function FileReader(props: FileReaderProps) {
  const { file, editable } = props;
  switch (file.kind) {
    case 'image':
      return <ImageReader file={file} />;
    case 'html':
      return <HtmlReader file={file} />;
    case 'pdf':
      return <PdfReader file={file} />;
    case 'markdown':
      // Editable mode always uses the source-view text reader so the user can
      // actually type. Readonly mode prefers MyST when an mdast is available.
      if (!editable && file.mdast) return <MarkdownReader file={file} />;
      return <TextReader {...props} />;
    case 'text':
    default:
      return <TextReader {...props} />;
  }
}
