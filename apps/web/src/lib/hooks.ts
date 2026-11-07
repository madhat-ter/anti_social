'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Me } from './api';

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
