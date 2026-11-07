'use client';
import type { Post } from '@/lib/api';
import type { usePaged } from '@/lib/hooks';
import { ListStatus, PagedFooter } from './Paged';
import { PostCard, replaceIn } from './PostCard';

export function PostList({ p, empty }: { p: ReturnType<typeof usePaged<Post>>; empty: string }) {
  return (
    <>
      <ListStatus p={p} count={p.items.length} empty={empty} />
      <div className="posts">
        {p.items.map((post) => (
          <PostCard key={post.id} post={post} onChange={(np) => p.setItems((cur) => replaceIn(cur, np))} />
        ))}
      </div>
      <PagedFooter p={p} />
    </>
  );
}
