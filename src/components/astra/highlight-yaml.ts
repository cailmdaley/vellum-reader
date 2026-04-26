/**
 * Lightweight YAML syntax highlighter for the astra source view.
 *
 * NOT a YAML parser. The job is "make a 1.x YAML file readable" — it tags
 * keys, quoted strings, numbers/bools/nulls, comments, list dashes, document
 * markers, flow brackets, anchors/aliases, and block-scalar markers. Block
 * scalar bodies (`>` / `|`) are tagged as a single string class until the
 * indentation drops back to the parent key's column.
 *
 * Edge cases the fixture doesn't exercise (multi-document `---`, anchored
 * tags, complex/explicit-key syntax `?`, set entries) are handled best-effort
 * — worst-case they render as plain text. All behavior is local; no external
 * dependency, no token validation. See `vellum-reader/vellum-native-astra-renderer`.
 */

export type YamlSpan = { cls: string | null; text: string };

interface YamlState {
  /**
   * Indent column of the line that opened a block scalar with `>` or `|`.
   * Subsequent lines whose indent is strictly greater (or which are blank)
   * are scalar content. The first line at indent ≤ this column ends the scalar.
   */
  blockScalarParentIndent: number | null;
}

const KEY_RE = /^([A-Za-z_][\w.-]*)(\s*:)(\s*)(.*)$/;
const LIST_RE = /^(-)(\s+|$)/;
const DOC_RE = /^(---|\.\.\.)\s*$/;
const BLOCK_SCALAR_RE = /^([>|])([+\-\d]*)(.*)$/;
const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const BOOL_RE = /^(true|false|True|False|TRUE|FALSE|yes|no|Yes|No|YES|NO)$/;
const NULL_RE = /^(null|Null|NULL|~)$/;

/**
 * Highlight a YAML document. Returns one span list per source line, in line
 * order. Newlines are NOT included in any span — the renderer joins lines.
 */
export function highlightYaml(text: string): YamlSpan[][] {
  const state: YamlState = { blockScalarParentIndent: null };
  return text.split('\n').map((line) => highlightLine(line, state));
}

function highlightLine(line: string, state: YamlState): YamlSpan[] {
  const indent = (line.match(/^[ \t]*/) || [''])[0].length;

  // Block scalar continuation: greedy — blank lines and any line indented
  // strictly more than the parent column belong to the scalar body.
  if (state.blockScalarParentIndent !== null) {
    if (line.trim() === '' || indent > state.blockScalarParentIndent) {
      return [{ cls: 'astra-source-view__string', text: line }];
    }
    state.blockScalarParentIndent = null;
  }

  if (line === '') return [{ cls: null, text: '' }];
  if (line.trim() === '') return [{ cls: null, text: line }];

  const ws = line.slice(0, indent);
  let body = line.slice(indent);
  const tokens: YamlSpan[] = [];
  if (ws) tokens.push({ cls: null, text: ws });

  // Whole-line comment.
  if (body.startsWith('#')) {
    tokens.push({ cls: 'astra-source-view__comment', text: body });
    return tokens;
  }

  // Document markers.
  const docMatch = DOC_RE.exec(body);
  if (docMatch) {
    tokens.push({ cls: 'astra-source-view__marker', text: docMatch[1] });
    if (body.length > docMatch[1].length) {
      tokens.push({ cls: null, text: body.slice(docMatch[1].length) });
    }
    return tokens;
  }

  // List marker. After a `- `, the body that follows can itself be a key
  // (`- key: value`) or a bare scalar (`- value`). Only consume one dash —
  // multiple `-` on one line is rare and the simple case covers the fixture.
  const listMatch = LIST_RE.exec(body);
  if (listMatch) {
    tokens.push({ cls: 'astra-source-view__marker', text: listMatch[1] });
    if (listMatch[2]) tokens.push({ cls: null, text: listMatch[2] });
    body = body.slice(listMatch[0].length);
    if (body === '') return tokens;
  }

  // key: value (key gold, value passed through value tokenizer).
  const keyMatch = KEY_RE.exec(body);
  if (keyMatch) {
    const [, key, colon, sp, value] = keyMatch;
    tokens.push({ cls: 'astra-source-view__key', text: key });
    tokens.push({ cls: null, text: colon + sp });
    if (value !== '') {
      tokens.push(...tokenizeValue(value, state, indent));
    }
    return tokens;
  }

  // Bare value continuation (rare at the line level — usually the value
  // sits on the same line as its key).
  tokens.push(...tokenizeValue(body, state, indent));
  return tokens;
}

function tokenizeValue(value: string, state: YamlState, parentIndent: number): YamlSpan[] {
  const tokens: YamlSpan[] = [];
  const trimmed = value.trimEnd();

  // Block scalar marker: must be the only thing on the line (modulo a
  // trailing comment). Sets state for the next line.
  const bsMatch = BLOCK_SCALAR_RE.exec(trimmed);
  if (bsMatch && (bsMatch[3].trim() === '' || /^\s*#/.test(bsMatch[3]))) {
    state.blockScalarParentIndent = parentIndent;
    const head = bsMatch[1] + bsMatch[2];
    tokens.push({ cls: 'astra-source-view__marker', text: head });
    const tail = bsMatch[3];
    if (tail) {
      // Trailing whitespace plus optional comment.
      const ci = tail.search(/#/);
      if (ci === -1) {
        tokens.push({ cls: null, text: tail });
      } else {
        if (ci > 0) tokens.push({ cls: null, text: tail.slice(0, ci) });
        tokens.push({ cls: 'astra-source-view__comment', text: tail.slice(ci) });
      }
    }
    if (value.length > trimmed.length) {
      tokens.push({ cls: null, text: value.slice(trimmed.length) });
    }
    return tokens;
  }

  // Trailing comment (only outside quotes, only after whitespace).
  const ci = findUnquotedComment(value);
  const body = ci === -1 ? value : value.slice(0, ci);
  const comment = ci === -1 ? null : value.slice(ci);

  tokens.push(...scanScalar(body));
  if (comment) tokens.push({ cls: 'astra-source-view__comment', text: comment });
  return tokens;
}

function findUnquotedComment(s: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inDouble) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (c === '\'') inSingle = false;
      continue;
    }
    if (c === '"') { inDouble = true; continue; }
    if (c === '\'') { inSingle = true; continue; }
    // YAML treats `#` as a comment only when preceded by whitespace
    // (or at start of scalar). At line start we already handled it.
    if (c === '#' && i > 0 && /\s/.test(s[i - 1])) {
      return i;
    }
  }
  return -1;
}

function scanScalar(text: string): YamlSpan[] {
  const tokens: YamlSpan[] = [];
  let i = 0;
  let buf = '';
  const flushBuf = () => {
    if (buf) {
      tokens.push(...classifyBareRun(buf));
      buf = '';
    }
  };

  while (i < text.length) {
    const c = text[i];

    // Quoted strings (single or double). We stop at the closing quote of the
    // same kind, allowing `\"` escapes inside double quotes.
    if (c === '"' || c === '\'') {
      flushBuf();
      const quote = c;
      const start = i;
      i++;
      while (i < text.length) {
        if (text[i] === '\\' && quote === '"') {
          i = Math.min(i + 2, text.length);
          continue;
        }
        if (text[i] === quote) { i++; break; }
        i++;
      }
      tokens.push({ cls: 'astra-source-view__string', text: text.slice(start, i) });
      continue;
    }

    // Flow brackets and commas.
    if (c === '[' || c === ']' || c === '{' || c === '}' || c === ',') {
      flushBuf();
      tokens.push({ cls: 'astra-source-view__marker', text: c });
      i++;
      continue;
    }

    // Anchors (&foo) and aliases (*foo). Only when at line start or after WS.
    if ((c === '&' || c === '*') && (i === 0 || /\s/.test(text[i - 1]))) {
      flushBuf();
      const start = i;
      i++;
      while (i < text.length && /[\w.-]/.test(text[i])) i++;
      tokens.push({ cls: 'astra-source-view__anchor', text: text.slice(start, i) });
      continue;
    }

    buf += c;
    i++;
  }
  flushBuf();
  return tokens;
}

function classifyBareRun(s: string): YamlSpan[] {
  const m = /^([\s]*)([\s\S]*?)([\s]*)$/.exec(s);
  if (!m) return [{ cls: null, text: s }];
  const [, lead, mid, trail] = m;
  const out: YamlSpan[] = [];
  if (lead) out.push({ cls: null, text: lead });
  if (mid) {
    if (NUM_RE.test(mid)) out.push({ cls: 'astra-source-view__number', text: mid });
    else if (BOOL_RE.test(mid)) out.push({ cls: 'astra-source-view__bool', text: mid });
    else if (NULL_RE.test(mid)) out.push({ cls: 'astra-source-view__null', text: mid });
    else out.push({ cls: null, text: mid });
  }
  if (trail) out.push({ cls: null, text: trail });
  return out;
}
