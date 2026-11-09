'use client';
/**
 * RFC §10.11: the feed's rules, in plain words. Linked from the end of the feed and the house rules.
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
          <li>Posts appear newest first, and nothing is ever moved up for being liked or replied to.</li>
          <li>A line marks where you left off, and the feed stops there. Older posts come only if you ask.</li>
          <li>
            If someone posts more than {FEED.foldAfter === 2 ? 'twice' : `${FEED.foldAfter} times`} in a day, their
            extra posts fold into one row you can open.
          </li>
          <li>People in their first three weeks are marked &ldquo;new here&rdquo; and are never folded.</li>
          <li>
            When an older post gets replies from {FEED.threadMinRepliers} or more people while you&rsquo;re away, you&rsquo;ll
            see one line about it at the time of the latest reply. A new event gets one line too.
          </li>
          <li>Only the author sees how many likes a post has.</li>
        </ol>
        <p className="meta">
          That&rsquo;s all of it. There is no score, no &ldquo;for you&rdquo;, and nothing learned from what you look at.
          The code is public: the <a href={`${SOURCE}/packages/shared/src/feed.ts`} rel="noopener noreferrer" target="_blank">fold</a> and
          the <a href={`${SOURCE}/apps/api/src/lib/feed.ts`} rel="noopener noreferrer" target="_blank">queries</a>.
        </p>
        <div className="row"><Link className="btn" href="/">Back to the feed</Link></div>
      </Win>
    </div>
  );
}
