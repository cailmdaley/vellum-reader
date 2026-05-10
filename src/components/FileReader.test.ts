import { describe, expect, it } from 'vitest';
import { resolveRelativeFileHref } from './FileReader';

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
