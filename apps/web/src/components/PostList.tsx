'use client';
import { Fragment } from 'react';
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

/** Posts newest first, with a poster-style header wherever the day changes. */
export function PostList({ p, empty, byDay = true, context = 'all' }: { p: ReturnType<typeof usePaged<Post>>; empty: string; byDay?: boolean; context?: 'all' | 'event' | 'none' }) {
  let last = '';
  return (
    <>
      <ListStatus p={p} count={p.items.length} empty={empty} />
      <div className="posts">
        {p.items.map((post) => {
          const day = byDay ? dayLabel(post.createdAt) : '';
          const header = byDay && day !== last;
          last = day;
          return (
            <Fragment key={post.id}>
              {header && <h2 className="day-h">{day}</h2>}
              <PostCard post={post} context={context} onChange={(np) => p.setItems((cur) => replaceIn(cur, np))} />
            </Fragment>
          );
        })}
      </div>
      <PagedFooter p={p} />
    </>
  );
}
