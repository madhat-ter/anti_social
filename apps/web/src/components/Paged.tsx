'use client';
import { useEffect, useRef } from 'react';
import { ErrorNote } from './ui';
import { Loading } from './retro';

interface PagedLike {
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  moreError: string | null;
  hasMore: boolean;
  loadMore: () => void;
}

/** Sentinel + "Load more" fallback. Re-observes after each page so a still-visible sentinel keeps loading. */
export function PagedFooter({ p }: { p: PagedLike }) {
  const ref = useRef<HTMLDivElement>(null);
  const { hasMore, loadingMore, loadMore, moreError } = p;
  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || loadingMore || moreError || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: '300px' });
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, loadingMore, loadMore, moreError]);

  if (p.loading || p.error) return null;
  return (
    <div ref={ref} className="paged-footer">
      <ErrorNote message={moreError} />
      {loadingMore && <p className="muted" role="status">Loading more…</p>}
      {hasMore && !loadingMore && <button type="button" className="btn" onClick={loadMore}>Load more</button>}
    </div>
  );
}

/** Loading / error / empty states for a paged list. */
export function ListStatus({ p, count, empty }: { p: PagedLike; count: number; empty: string }) {
  if (p.loading) return <Loading />;
  if (p.error) return <ErrorNote message={p.error} />;
  if (count === 0) return <p className="empty">{empty}</p>;
  return null;
}
