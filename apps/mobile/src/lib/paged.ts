/**
 * A paged list from the API (`{ items, nextCursor }`), kept in the query cache so it shows at once
 * on the next launch. `setItems` changes one loaded item in place (a like, an edit, a delete), the
 * way the website's usePaged does.
 */
import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { errorMessage, type Page } from './api';

export function usePaged<T, P extends Page<T> = Page<T>>(key: QueryKey, fetchPage: (cursor: string | null) => Promise<P>, enabled = true) {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const first = q.data?.pages[0] ?? null;

  const setItems = useCallback((fn: (cur: T[]) => T[]) => {
    qc.setQueryData<InfiniteData<P, string | null>>(key, (d) => {
      if (!d) return d;
      // apply the change to the flat list, then cut it back into the pages it came in
      const sizes = d.pages.map((p) => p.items.length);
      const next = fn(d.pages.flatMap((p) => p.items));
      let at = 0;
      const pages = d.pages.map((p, i) => {
        const take = i === d.pages.length - 1 ? next.length - at : sizes[i]!;
        const part = next.slice(at, at + take);
        at += take;
        return { ...p, items: part };
      });
      return { ...d, pages };
    });
  }, [qc, key]);

  return {
    items, first, setItems,
    loading: q.isPending && enabled,
    error: q.isError && !q.data ? errorMessage(q.error) : null,
    hasMore: !!q.hasNextPage,
    loadingMore: q.isFetchingNextPage,
    loadMore: () => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); },
    refreshing: q.isRefetching && !q.isFetchingNextPage,
    refresh: () => q.refetch(),
  };
}
export type Paged<T> = ReturnType<typeof usePaged<T>>;
