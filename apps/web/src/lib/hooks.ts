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

// ─── tab titles: "(3) Feed – anti" ──────────────────────────────────────────
let pageTitle = '';
let unreadInTitle = 0;
function applyTitle() {
  if (typeof document === 'undefined') return;
  const base = pageTitle ? `${pageTitle} – anti` : 'anti';
  document.title = unreadInTitle > 0 ? `(${unreadInTitle > 99 ? '99+' : unreadInTitle}) ${base}` : base;
}
/** Sets this page's tab title. */
export function useTitle(title: string) {
  useEffect(() => { pageTitle = title; applyTitle(); }, [title]);
}
/** Called by the nav when the unread count changes. */
export function setUnreadInTitle(n: number) { unreadInTitle = n; applyTitle(); }

/**
 * One way of writing dates everywhere (UX pass, 2026-11-09):
 * - `relativeTime`: "just now", "5m", "3h", "2d" within a week; after that the day, "Thu, Nov 5",
 *   with the year only when it is not this year.
 * - `fmtDate`: an exact moment, "Nov 8, 5:30 PM"; the year only when it is not this year.
 */
export function fmtDate(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
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
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  });
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
          // members have a handle, not an id; items with neither are never treated as duplicates
          const keyOf = (x: T) => (x as { id?: string }).id ?? (x as { handle?: string }).handle;
          const seen = new Set(cur.map(keyOf).filter(Boolean));
          return [...cur, ...p.items.filter((x) => { const k = keyOf(x); return !k || !seen.has(k); })];
        });
        setCursor(p.nextCursor); setHasMore(!!p.nextCursor);
      },
      (e) => { if (g === gen.current) setMoreError(errorMessage(e)); },
    ).finally(() => { busy.current = false; if (g === gen.current) setLoadingMore(false); });
  }, [cursor, hasMore]);

  return { items, setItems, loading, loadingMore, error, moreError, hasMore, loadMore };
}
