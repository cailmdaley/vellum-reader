import { describe, expect, it } from 'vitest';
import { buildFileModeHref, resolveRelativeFileHref } from './FileReader';

describe('resolveRelativeFileHref', () => {
  const base = '/Users/cd280747/project/skills/lc-from-paper/SKILL.md';

  it('resolves sibling-relative markdown links from the current file directory', () => {
    expect(resolveRelativeFileHref(base, 'references/interview.md')).toEqual({
      path: '/Users/cd280747/project/skills/lc-from-paper/references/interview.md',
      jumpToLine: undefined,
    });
  });

  it('normalizes parent directory segments and line anchors', () => {
    expect(resolveRelativeFileHref(base, '../shared/notes.md#L42')).toEqual({
      path: '/Users/cd280747/project/skills/shared/notes.md',
      jumpToLine: 42,
    });
  });

  it('leaves external, root, and same-page anchors alone', () => {
    expect(resolveRelativeFileHref(base, 'https://example.com')).toBeNull();
    expect(resolveRelativeFileHref(base, '/fiber/slug')).toBeNull();
    expect(resolveRelativeFileHref(base, '#section')).toBeNull();
  });
});

describe('buildFileModeHref', () => {
  it('canonicalizes file-mode links back to the hash router root', () => {
    expect(buildFileModeHref(
      'http://localhost:5173/references/paper-reproduction.md#city=lightcone&mode=narrative&file=%2Fold%2FSKILL.md',
      '/Users/cd280747/project/skills/narrative/references/paper-reproduction.md',
    )).toBe(
      '/#city=lightcone&mode=narrative&file=%2FUsers%2Fcd280747%2Fproject%2Fskills%2Fnarrative%2Freferences%2Fpaper-reproduction.md',
    );
  });

  it('replaces a fiber route with file mode when building a file link', () => {
    expect(buildFileModeHref(
      'http://localhost:5173/#city=lightcone&mode=narrative&fiber=some%2Ffiber',
      '/tmp/notes.md',
    )).toBe('/#city=lightcone&mode=narrative&file=%2Ftmp%2Fnotes.md');
  });
});
