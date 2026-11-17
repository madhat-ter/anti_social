'use client';
import { Fragment, type ReactNode } from 'react';
import type { Post } from '@/lib/api';
import type { usePaged } from '@/lib/hooks';
import { ListStatus, PagedFooter } from './Paged';
import { PostCard, replaceIn } from './PostCard';

/** "Today", "Yesterday", or "Thu, Nov 5" in the viewer's time zone. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * Posts newest first, with a poster-style header wherever the day changes.
 * `interlude` puts something (the pick window on phones) after the `after`-th post, or after the
 * last one when there are fewer, so the first screen is posts and not furniture.
 */
export function PostList({ p, empty, byDay = true, context = 'all', interlude, framed }: {
  p: ReturnType<typeof usePaged<Post>>; empty: string; byDay?: boolean; context?: 'all' | 'event' | 'none';
  interlude?: { after: number; node: ReactNode };
  /** each post its own framed card, shaped by what it is (RFC §10.15): a profile's posts */
  framed?: boolean;
}) {
  let last = '';
  const n = p.items.length;
  const at = interlude ? Math.min(interlude.after, n) - 1 : -1;
  return (
    <>
      <ListStatus p={p} count={n} empty={empty} />
      {interlude && n === 0 && !p.loading && !p.error && interlude.node}
      <div className={`posts${framed ? ' cards' : ''}`}>
        {p.items.map((post, i) => {
          const day = byDay ? dayLabel(post.createdAt) : '';
          const header = byDay && day !== last;
          last = day;
          return (
            <Fragment key={post.id}>
              {header && <h2 className="day-h">{day}</h2>}
              <PostCard framed={framed} post={post} context={context} onChange={(np) => p.setItems((cur) => replaceIn(cur, np))} />
              {i === at && <div className="interlude">{interlude!.node}</div>}
            </Fragment>
          );
        })}
      </div>
      <PagedFooter p={p} />
    </>
  );
}
