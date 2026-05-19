import { mystParse } from 'myst-parser';
import { tabDirectives } from 'myst-ext-tabs';
import { proofDirective } from 'myst-ext-proof';
import katex from 'katex';

import { embedDirective } from './embed-directive.js';

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g;

function renderMath(node: any, macros?: Record<string, string>): void {
  if (!node || typeof node.value !== 'string') return;
  try {
    node.html = katex.renderToString(node.value, {
      displayMode: node.type === 'math',
      throwOnError: false,
      output: 'html',
      macros: macros ?? {},
    });
  } catch (error: any) {
    node.error = true;
    node.message = error?.message ?? String(error);
  }
}

function walkRenderMath(node: any, macros?: Record<string, string>): void {
  if (!node) return;
  if (node.type === 'math' || node.type === 'inlineMath') renderMath(node, macros);
  if (Array.isArray(node.children)) {
    node.children.forEach((child: any) => walkRenderMath(child, macros));
  }
}

function unwrapDirectiveWrappers(node: any): void {
  if (!Array.isArray(node?.children)) return;
  const next: any[] = [];
  for (const child of node.children) {
    if (
      (child?.type === 'mystDirective' || child?.type === 'mystRole') &&
      Array.isArray(child.children) &&
      child.children.length > 0
    ) {
      child.children.forEach(unwrapDirectiveWrappers);
      next.push(...child.children);
      continue;
    }
    unwrapDirectiveWrappers(child);
    next.push(child);
  }
  node.children = next;
}

function flattenInlineText(node: any): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) return node.children.map(flattenInlineText).join('');
  return '';
}

function replaceTocNodes(root: any, build: (node: any, index: number) => any): void {
  if (!Array.isArray(root?.children)) return;
  root.children = root.children.map((child: any, index: number) =>
    child?.type === 'toc' ? build(child, index) : child,
  );
}

function transformToc(root: any): void {
  if (!Array.isArray(root?.children)) return;

  type HeadingEntry = { text: string; depth: number; index: number };
  const headings: HeadingEntry[] = [];
  root.children.forEach((child: any, index: number) => {
    if (child?.type !== 'heading') return;
    const text = flattenInlineText(child).trim();
    if (!text) return;
    headings.push({ text, depth: Math.min(6, Math.max(1, child.depth ?? 1)), index });
  });

  if (headings.length === 0) {
    replaceTocNodes(root, () => ({
      type: 'paragraph',
      children: [{ type: 'emphasis', children: [{ type: 'text', value: '(no headings in this section)' }] }],
    }));
    return;
  }

  replaceTocNodes(root, (tocNode, tocIndex) => {
    const kind = typeof tocNode.kind === 'string' ? tocNode.kind : 'project';
    const maxDepth = typeof tocNode.depth === 'number' ? tocNode.depth : 6;

    let scoped = headings.slice();
    if (kind === 'section') {
      const enclosing = [...headings].reverse().find((heading) => heading.index < tocIndex);
      if (enclosing) {
        scoped = [];
        for (const heading of headings) {
          if (heading.index <= tocIndex) continue;
          if (heading.depth <= enclosing.depth) break;
          scoped.push(heading);
        }
      }
    }

    const items = scoped
      .filter((heading) => heading.depth <= maxDepth)
      .map((heading) => ({
        type: 'listItem',
        spread: false,
        children: [{ type: 'paragraph', children: [{ type: 'text', value: heading.text }] }],
      }));

    if (items.length === 0) {
      return {
        type: 'paragraph',
        children: [{ type: 'emphasis', children: [{ type: 'text', value: '(no headings in scope)' }] }],
      };
    }

    return {
      type: 'list',
      ordered: false,
      spread: false,
      children: items,
    };
  });
}

function splitTextNode(value: string): any[] {
  const nodes: any[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(value)) !== null) {
    const [full, rawSlug, rawLabel] = match;
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) });
    }
    const slug = rawSlug.trim();
    const label = (rawLabel ?? slug).trim() || slug;
    nodes.push({
      type: 'link',
      url: `felt://${slug}`,
      children: [{ type: 'text', value: label }],
    });
    lastIndex = match.index + full.length;
  }

  if (lastIndex < value.length) {
    nodes.push({ type: 'text', value: value.slice(lastIndex) });
  }

  return nodes;
}

function transformWikiLinks(node: any): void {
  if (!Array.isArray(node?.children)) return;
  const next: any[] = [];
  for (const child of node.children) {
    if (child?.type === 'text' && typeof child.value === 'string' && WIKILINK_RE.test(child.value)) {
      next.push(...splitTextNode(child.value));
      WIKILINK_RE.lastIndex = 0;
      continue;
    }
    transformWikiLinks(child);
    next.push(child);
  }
  node.children = next;
}

export function markdownToMystAST(
  content: string,
  opts: { macros?: Record<string, string> } = {},
): any {
  const tree = mystParse(content, {
    extensions: { strikethrough: true },
    directives: [...tabDirectives, proofDirective, embedDirective],
  }) as any;
  unwrapDirectiveWrappers(tree);
  transformToc(tree);
  walkRenderMath(tree, opts.macros);
  transformWikiLinks(tree);
  return tree;
}

export function astToPlainText(node: any): string {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(astToPlainText).join(' ');
}
