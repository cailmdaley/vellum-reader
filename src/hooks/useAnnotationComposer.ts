/**
 * useAnnotationComposer — substrate-agnostic state machine for
 * drafting a new annotation comment.
 *
 * Owns the "is the composer open / what has the user typed / when do
 * we submit or dismiss" parts of the annotation flow that
 * `TextAnnotationLayer` (prose) and `FileReader` (CodeMirror)
 * independently re-implemented. Each component still owns its own
 * **rendering** — the in-margin contentEditable in prose mode, the
 * popup textarea in code mode — and its own substrate-specific
 * **selection extraction** (DOM Range vs CodeMirror EditorState).
 * Only the controller logic is shared here.
 *
 * Lifecycle:
 *   1. Host detects a fresh selection and calls `open()`.
 *   2. Host renders an input bound to `text`/`setText`, attaches
 *      `keyDown` and `inputRef`.
 *   3. User types. Enter (no Shift) submits via `onSubmit`; Shift+
 *      Enter inserts a newline; Escape calls `dismiss`.
 *   4. On successful submit (the `onSubmit` callback resolves
 *      truthy), the hook resets internal state. On failure it leaves
 *      the draft intact so the user can retry.
 *
 * `onSubmit` returns the persisted annotation (or anything truthy)
 * to signal success, or `null`/`undefined` for failure. The hook
 * doesn't itself touch the network — the host owns the adapter call
 * because each substrate enriches the create payload differently
 * (TextAnnotationLayer adds `selectedText/contextBefore/contextAfter`
 * from a DOM Range; FileReader adds `from/to/line/endLine` from a
 * CodeMirror selection).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseAnnotationComposerOptions {
  /** Persist the draft. Return any truthy value to signal success
   *  (the hook will reset state); return null/undefined/false to
   *  signal failure (state is preserved so the user can fix and
   *  retry). The host is responsible for the adapter call and any
   *  upstream annotation-list update. */
  onSubmit: (text: string) => unknown | Promise<unknown>;
}

export interface AnnotationComposer {
  /** Whether the composer is currently visible. Mirrors the legacy
   *  `showCommentBox` boolean at both call sites. */
  open: boolean;
  /** Live draft text. Bind to a textarea's `value` /
   *  contentEditable's `textContent`. */
  text: string;
  /** Update the draft text — fires from onChange / onInput. */
  setText: (next: string) => void;
  /** Open the composer with empty text (or a seeded value). */
  start: (initial?: string) => void;
  /** Close the composer and discard the draft. */
  dismiss: () => void;
  /** Submit the current draft via `onSubmit`. Trims whitespace; no-op
   *  if the trimmed text is empty. Resets state on truthy result. */
  submit: () => Promise<void>;
  /** Standard keyboard handler — wire into the input element's
   *  `onKeyDown`. Enter (no Shift) → submit; Shift+Enter → newline
   *  (default behavior preserved); Escape → dismiss. Stops
   *  propagation on Enter/Escape so a wrapping CodeMirror keymap
   *  doesn't swallow them. */
  keyDown: (e: React.KeyboardEvent) => void;
  /** Attach to the input element to receive focus on open.
   *  Generic over textarea/contentEditable host element via
   *  `HTMLElement`; cast at the call site if needed. */
  inputRef: React.RefObject<HTMLElement>;
}

export function useAnnotationComposer(
  options: UseAnnotationComposerOptions,
): AnnotationComposer {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  // Generic ref so callers can attach it to either a `<textarea>` or
  // a contentEditable `<div>`. Both implement `.focus()` so the
  // shared `useEffect` below works without a per-substrate branch.
  const inputRef = useRef<HTMLElement>(null);

  // Hold the latest onSubmit in a ref so the keyDown handler doesn't
  // need to be re-created (and re-attached) every render — the host
  // typically passes a fresh closure each render.
  const onSubmitRef = useRef(options.onSubmit);
  onSubmitRef.current = options.onSubmit;

  const start = useCallback((initial: string = '') => {
    setText(initial);
    setOpen(true);
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
    setText('');
  }, []);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const result = await onSubmitRef.current(trimmed);
    // Truthy result → success. Reset for the next draft. Falsy →
    // leave the draft in place so the user can fix and retry.
    if (result) {
      setOpen(false);
      setText('');
    }
  }, [text]);

  const keyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        void submit();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      }
    },
    [submit, dismiss],
  );

  // Auto-focus when the composer opens. ContentEditable callers also
  // typically want the caret placed at the end — that's substrate-
  // specific (Range API for contentEditable, .setSelectionRange for
  // textarea) so it's left to the host. Plain focus is enough to
  // make typing land in the right element.
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  return { open, text, setText, start, dismiss, submit, keyDown, inputRef };
}
