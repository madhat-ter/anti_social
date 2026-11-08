import { Elysia } from 'elysia';
import type { Cookie } from 'elysia';
import { SEATED_STATES } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { setupComplete } from '../lib/contact';
import { resolveSession, touchLastSeen, SESSION_MAX_AGE_S, type Auth } from '../lib/sessions';

export const SESSION_COOKIE = 'anti_session';
export type CookieJar = Record<string, Cookie<unknown>>;

export function authPlugin(deps: Deps, seed?: unknown) {
  return new Elysia({ name: 'auth', seed }).derive({ as: 'global' }, async ({ headers, cookie }) => {
    const authz = headers['authorization'];
    let token: string | undefined;
    if (authz && /^Bearer\s+/i.test(authz)) token = authz.replace(/^Bearer\s+/i, '').trim();
    else {
      const c = (cookie as CookieJar)[SESSION_COOKIE]?.value;
      if (typeof c === 'string' && c) token = c;
    }
    let auth: Auth | null = null;
    if (token) {
      auth = await resolveSession(deps.db, token);
      if (auth && (auth.user.state === 'banned' || auth.user.state === 'deleted')) auth = null;
      if (auth) await touchLastSeen(deps.db, auth.user.id);
    }
    return { auth };
  });
}

export function requireUser(auth: Auth | null): Auth {
  if (!auth) throw new ApiError(401, 'unauthenticated');
  return auth;
}

/**
 * A member with a seat who has finished setup (RFC §10.3): About you, gender, birthday, and contact
 * details for admins (§10.7, while CONTACT_KEY is set). Until
 * then everything a seat gives is locked; /me, /me/setup, settings and sign-out still work.
 */
export function requireSeated(auth: Auth | null): Auth {
  const a = requireUser(auth);
  if (!SEATED_STATES.includes(a.user.state)) throw new ApiError(403, 'no_seat', 'You do not have a seat.');
  if (!setupComplete(a.user)) throw new ApiError(403, 'setup_required', 'Finish setting up your profile first.');
  return a;
}

export function setSessionCookie(cookie: CookieJar, token: string, secure: boolean) {
  cookie[SESSION_COOKIE]!.set({
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
}

export function clearSessionCookie(cookie: CookieJar) {
  cookie[SESSION_COOKIE]!.set({ value: '', path: '/', maxAge: 0 });
}
