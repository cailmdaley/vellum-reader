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
 *   - `pdf` — placeholder with an "open externally" link; a pdfjs-dist
 *     renderer lands in a follow-up iteration (PDF.js is bigger than the rest
 *     of the reader combined).
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

function PdfReader({ file }: FileReaderProps) {
  return (
    <div className="vellum-file-reader vellum-file-reader--pdf">
      <p>PDF rendering is not yet wired in vellum.</p>
      {file.url ? (
        <p>
          <a href={file.url} target="_blank" rel="noreferrer">
            Open {file.path} externally
          </a>
        </p>
      ) : null}
    </div>
  );
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
