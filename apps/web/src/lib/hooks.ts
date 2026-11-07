'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage, type Me, type Page } from './api';

/** Loads /me; `me` is null when signed out. */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.error === 'unauthenticated')) setMe(null);
      else setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { me, loading, error, refresh, setMe };
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function isSeated(me: Me | null): boolean {
  return !!me && (me.state === 'active' || me.state === 'flagged_lurker');
}

/**
 * Cursor-paginated list with infinite scroll. `key` identifies the query;
 * changing it resets the list. Render <PagedFooter> below the list.
 */
export function usePaged<T>(key: string, fetchPage: (cursor: string | null) => Promise<Page<T>>, enabled = true) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const gen = useRef(0);
  const busy = useRef(false);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  useEffect(() => {
    if (!enabled) return;
    const g = ++gen.current;
    busy.current = false;
    setItems([]); setCursor(null); setHasMore(false); setLoading(true); setError(null); setMoreError(null);
    fetchRef.current(null).then(
      (p) => {
        if (g !== gen.current) return;
        setItems(p.items); setCursor(p.nextCursor); setHasMore(!!p.nextCursor); setLoading(false);
      },
      (e) => { if (g === gen.current) { setError(errorMessage(e)); setLoading(false); } },
    );
  }, [key, enabled]);

  const loadMore = useCallback(() => {
    if (busy.current || !hasMore || !cursor) return;
    busy.current = true;
    const g = gen.current;
    setLoadingMore(true); setMoreError(null);
    fetchRef.current(cursor).then(
      (p) => {
        if (g !== gen.current) return;
        setItems((cur) => {
          const seen = new Set(cur.map((x) => (x as { id?: string }).id));
          return [...cur, ...p.items.filter((x) => !seen.has((x as { id?: string }).id))];
        });
        setCursor(p.nextCursor); setHasMore(!!p.nextCursor);
      },
      (e) => { if (g === gen.current) setMoreError(errorMessage(e)); },
    ).finally(() => { busy.current = false; if (g === gen.current) setLoadingMore(false); });
  }, [cursor, hasMore]);

  return { items, setItems, loading, loadingMore, error, moreError, hasMore, loadMore };
}
