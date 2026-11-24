/**
 * Who is signed in. The token is read from the keychain once at start; `me` comes from GET /me and
 * is cached (react-query, kept on the phone between launches so the app opens to the last feed even
 * without signal). The root layout guards its screens with `status`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, loadToken, setSignedOutHandler, type Me } from './api';
import { persister } from './query';

export type Status = 'starting' | 'offline' | 'signedOut' | 'setup' | 'waiting' | 'seated';

interface Session {
  status: Status;
  me: Me | null;
  /** after a sign-in or join: the token is saved already, load who we are */
  signedIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<Me | null>;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
};
/** a seated member's own account (screens behind the seated guard only) */
export const useMe = (): Me => {
  const { me } = useSession();
  if (!me) throw new Error('useMe without a member');
  return me;
};

export const isSeated = (me: Me | null) => !!me && (me.state === 'active' || me.state === 'flagged_lurker');

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => { loadToken().then((t) => setHasToken(!!t), () => setHasToken(false)); }, []);

  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try { return await api.me(); } catch (e) {
        if (e instanceof ApiError && e.status === 401) { setHasToken(false); return null; }
        throw e;
      }
    },
    enabled: hasToken === true,
    staleTime: 30_000,
  });

  const forgetAll = useCallback(async () => {
    setHasToken(false);
    qc.clear();
    await persister.removeClient();
  }, [qc]);

  useEffect(() => {
    setSignedOutHandler(() => { void forgetAll(); });
    return () => setSignedOutHandler(null);
  }, [forgetAll]);

  const signedIn = useCallback(async () => {
    qc.clear();
    setHasToken(true);
    await qc.fetchQuery({ queryKey: ['me'], queryFn: () => api.me() });
  }, [qc]);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch { /* signed out here either way */ }
    await forgetAll();
  }, [forgetAll]);

  const refreshMe = useCallback(async () => {
    const r = await meQ.refetch();
    return r.data ?? null;
  }, [meQ]);

  const me = hasToken ? meQ.data ?? null : null;
  const status: Status =
    hasToken === null || (hasToken && meQ.data === undefined && !meQ.isError) ? 'starting'
    // signed in, but the server could not be reached and nothing is saved yet
    : hasToken && meQ.data === undefined ? 'offline'
    : !me ? 'signedOut'
    : me.setupNeeded ? 'setup'
    : isSeated(me) ? 'seated'
    : 'waiting';

  const value = useMemo(() => ({ status, me, signedIn, signOut, refreshMe }), [status, me, signedIn, signOut, refreshMe]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
