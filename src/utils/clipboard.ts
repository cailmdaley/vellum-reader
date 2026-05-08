const LIST_MARKER_AT_LINE_START = /(^|\n)([ \t]*(?:[•*-]|\d{1,3}[.)]))[ \t]*/g;
const LIST_MARKER_BEFORE_NEWLINE = /(^|\n)([ \t]*(?:[•*-]|\d{1,3}[.)]))[ \t]*\n[ \t]*(?=\S)/g;

export function normalizePretextCopiedText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(LIST_MARKER_BEFORE_NEWLINE, '$1$2 ')
    .replace(
      LIST_MARKER_AT_LINE_START,
      (match, lineStart: string, marker: string, offset: number, full: string) => {
        const after = full[offset + match.length];
        if (after == null || after === ' ' || after === '\t' || after === '\n') return match;
        return `${lineStart}${marker} `;
      },
    );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function plainTextToClipboardHtml(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line.length > 0 ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>',
    )
    .join('');
}
