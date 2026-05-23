import { describe, expect, it } from 'vitest';
import { chromeAnnotationsForFileViewer, resolveDoneIntent } from './FileViewerPage';
import type { Annotation } from '../utils/content-types';

function annotation(id: string): Annotation {
  return {
    id,
    slug: 'file.md',
    kind: 'text',
    selectedText: 'text',
    contextBefore: '',
    contextAfter: '',
    comment: id,
    createdAt: 1,
  };
}

describe('chromeAnnotationsForFileViewer', () => {
  it('does not publish stored annotations while the file kind is still loading', () => {
    expect(chromeAnnotationsForFileViewer(null, [annotation('stored')], null)).toEqual([]);
  });

  it('uses anchored annotations for markdown and text surfaces', () => {
    const stored = [annotation('stored')];
    const visible = [annotation('visible')];

    expect(chromeAnnotationsForFileViewer('markdown', stored, visible)).toEqual(visible);
    expect(chromeAnnotationsForFileViewer('text', stored, null)).toEqual([]);
  });

  it('keeps raw rows available for non-text file surfaces', () => {
    const stored = [annotation('stored')];
    expect(chromeAnnotationsForFileViewer('image', stored, null)).toEqual(stored);
  });
});

describe('resolveDoneIntent', () => {
  it('flips straight to read view when the buffer is clean', () => {
    // Clicking Done on a clean buffer should be friction-free: no
    // confirm dialog, no chance to silently lose work because there
    // is none.
    expect(resolveDoneIntent(false)).toBe('flip-readonly');
  });

  it('asks before discarding unsaved edits', () => {
    // Previously gated by `!window.confirm(...)`, which silently
    // returned false in Tauri's WKWebView; the Done button looked
    // dead. The intent is now explicit and the dialog lives in the
    // document.
    expect(resolveDoneIntent(true)).toBe('ask-discard');
  });
});
