'use client';
/**
 * RFC §10.11 and §10.23: the feed's rules, in plain words. Linked from the end of the feed and the house rules.
 * Open to anyone: the promise on the landing page should be checkable before you have a seat.
 */
import Link from 'next/link';
import { FEED } from '@anti/shared';
import { useTitle } from '@/lib/hooks';
import { Win } from '@/components/retro';

const SOURCE = 'https://github.com/madhat-ter/anti_social/blob/main';

export default function FeedRulesPage() {
  useTitle('How the feed works');
  return (
    <div className="stack feed-rules">
      <h1>How the feed works</h1>
      <Win title="the_rules" bodyClassName="stack">
        <ol className="feed-rules-list">
          <li id="mixed">
            The newest post is always on top. Below it, what&rsquo;s new since your last visit is mixed: newer posts
            usually come first (a post&rsquo;s odds halve every {FEED.mixHalfLifeHours} hours), and one person&rsquo;s posts
            are spread apart, so nobody posting ten things in a row can bury someone else&rsquo;s one.
          </li>
          <li>
            The mix stays the same for your whole visit, through reloads; your next visit gets a new one. It uses only
            when something was posted and who posted it. Nothing is ever moved up for being liked or replied to.
          </li>
          <li>
            Prefer the plain timeline? Choose <b>Newest first</b> in <Link href="/settings#feed">Settings → Feed</Link>.
          </li>
          <li>A line marks where you left off, and the feed stops there. Older posts come only if you ask, newest first.</li>
          <li>
            If someone posts more than {FEED.foldAfter === 2 ? 'twice' : `${FEED.foldAfter} times`} in a day, their
            extra posts fold into one row you can open.
          </li>
          <li>People in their first three weeks are marked &ldquo;new here&rdquo; and are never folded.</li>
          <li>
            When an older post gets replies from {FEED.threadMinRepliers} or more people while you&rsquo;re away, you&rsquo;ll
            see one line about it among the new posts. A new event gets one line too.
          </li>
          <li>Only the author sees how many likes a post has.</li>
        </ol>
        <p className="meta">
          That&rsquo;s all of it. There is no score, no &ldquo;for you&rdquo;, and nothing learned from what you look at.
          The code is public: the <a href={`${SOURCE}/packages/shared/src/feed.ts`} rel="noopener noreferrer" target="_blank">mix and the fold</a> and
          the <a href={`${SOURCE}/apps/api/src/lib/feed.ts`} rel="noopener noreferrer" target="_blank">queries</a>.
        </p>
        <div className="row"><Link className="btn" href="/">Back to the feed</Link></div>
      </Win>
    </div>
  );
}
