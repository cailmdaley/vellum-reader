/**
 * Walk a MyST mdast tree and promote standalone tweet-URL paragraphs to a
 * custom `tweetEmbed` node. A paragraph is eligible when its only significant
 * child is a link whose URL matches an x.com / twitter.com /status/:id path;
 * incidental whitespace text nodes are tolerated.
 *
 * Why a preprocess instead of a link-selector renderer: react-tweet renders
 * `<div><article>`, which is block-level and invalid inside MyST's paragraph
 * `<p>` wrapper. Rewriting the containing paragraph sidesteps the nesting
 * issue and makes the embed a first-class block node.
 */

const TWEET_URL_RE = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i;

function isWhitespaceText(node: any): boolean {
  return node?.type === 'text' && typeof node.value === 'string' && node.value.trim() === '';
}

function extractTweetId(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(TWEET_URL_RE);
  return m ? m[1] : null;
}

function paragraphTweetId(paragraph: any): string | null {
  if (paragraph?.type !== 'paragraph' || !Array.isArray(paragraph.children)) return null;
  const significant = paragraph.children.filter((c: any) => !isWhitespaceText(c));
  if (significant.length !== 1) return null;
  const only = significant[0];
  if (only?.type !== 'link') return null;
  return extractTweetId(only.url);
}

export function transformTweetEmbeds<T extends { children?: any[] }>(node: T): T {
  if (!node || typeof node !== 'object') return node;
  const children = (node as any).children;
  if (!Array.isArray(children)) return node;

  const nextChildren = children.map((child: any) => {
    const id = paragraphTweetId(child);
    if (id) {
      return { type: 'tweetEmbed', tweetId: id };
    }
    return transformTweetEmbeds(child);
  });

  return { ...node, children: nextChildren };
}
