/**
 * TweetEmbed — renders a tweet via react-tweet.
 *
 * Wired through a custom MyST `tweetEmbed` node that the tweet-transform
 * preprocess creates from standalone tweet-URL paragraphs. See
 * utils/tweet-transform.ts.
 *
 * react-tweet fetches tweet data from Twitter's public syndication endpoint
 * (no platform.twitter.com widget script, no iframe), so this works in a
 * pure client SPA. Images load fine from pbs.twimg.com, but mp4s on
 * video.twimg.com return 403 to any browser Origin other than twitter.com.
 * We rewrite video URLs in the tweet data to hit the dev proxy at
 * /twimg-video (see vite.config.ts), which forwards node-to-node and
 * bypasses the browser's Sec-Fetch-Site header.
 */

import { EmbeddedTweet, TweetSkeleton, useTweet } from 'react-tweet';
import type { Tweet } from 'react-tweet/api';

const TWIMG_VIDEO_HOST = 'https://video.twimg.com';

function rewriteVideoUrls(tweet: Tweet): Tweet {
  if (!tweet.mediaDetails) return tweet;
  const mediaDetails = tweet.mediaDetails.map((media) => {
    if (!media.video_info?.variants) return media;
    const variants = media.video_info.variants.map((v) =>
      v.url.startsWith(TWIMG_VIDEO_HOST)
        ? { ...v, url: '/twimg-video' + v.url.slice(TWIMG_VIDEO_HOST.length) }
        : v,
    );
    return { ...media, video_info: { ...media.video_info, variants } };
  });
  return { ...tweet, mediaDetails };
}

export function TweetEmbed({ id }: { id: string }) {
  const { data, isLoading, error } = useTweet(id);
  return (
    <div className="vellum-tweet-embed" data-tweet-id={id}>
      {isLoading || !data ? (
        <TweetSkeleton />
      ) : error ? (
        <div>Tweet unavailable.</div>
      ) : (
        <EmbeddedTweet tweet={rewriteVideoUrls(data)} />
      )}
    </div>
  );
}

/** MyST renderer for our custom `tweetEmbed` node. */
export function TweetEmbedRenderer({ node }: { node: { tweetId?: string } }) {
  if (!node?.tweetId) return null;
  return <TweetEmbed id={node.tweetId} />;
}
