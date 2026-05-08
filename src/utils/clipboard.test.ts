import { describe, expect, it } from 'vitest';
import { normalizePretextCopiedText, plainTextToClipboardHtml } from './clipboard';

describe('normalizePretextCopiedText', () => {
  it('joins separated bullet markers to their item text', () => {
    expect(normalizePretextCopiedText('•\nfirst item\n•\nsecond item')).toBe(
      '• first item\n• second item',
    );
  });

  it('adds a missing space after inline list markers', () => {
    expect(normalizePretextCopiedText('1.First\n2)Second\n•Third')).toBe(
      '1. First\n2) Second\n• Third',
    );
  });

  it('leaves already-spaced list items alone', () => {
    expect(normalizePretextCopiedText('• first item\n  • nested item')).toBe(
      '• first item\n  • nested item',
    );
  });

  it('normalizes non-breaking spaces emitted by rich clipboard text', () => {
    expect(normalizePretextCopiedText('one\u00a0two')).toBe('one two');
  });
});

describe('plainTextToClipboardHtml', () => {
  it('escapes text and preserves blank lines', () => {
    expect(plainTextToClipboardHtml('a < b\n\n"quoted"')).toBe(
      '<div>a &lt; b</div><div><br></div><div>&quot;quoted&quot;</div>',
    );
  });
});
