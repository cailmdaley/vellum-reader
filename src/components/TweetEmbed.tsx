/**
 * TweetEmbed — renders a tweet via react-tweet.
 *
 * Wired through a custom MyST `tweetEmbed` node that the tweet-transform
 * preprocess creates from standalone tweet-URL paragraphs. See
 * utils/tweet-transform.ts.
 *
 * react-tweet fetches tweet data from Twitter's public syndication endpoint
 * (no platform.twitter.com widget script, no iframe), so this works in a
 * pure client SPA.
 */

import { Tweet } from 'react-tweet';

export function TweetEmbed({ id }: { id: string }) {
  return (
    <div className="vellum-tweet-embed" data-tweet-id={id}>
      <Tweet id={id} />
    </div>
  );
}

/** MyST renderer for our custom `tweetEmbed` node. */
export function TweetEmbedRenderer({ node }: { node: { tweetId?: string } }) {
  if (!node?.tweetId) return null;
  return <TweetEmbed id={node.tweetId} />;
}
