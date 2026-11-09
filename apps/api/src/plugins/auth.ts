import { Elysia } from 'elysia';
import type { Cookie } from 'elysia';
import { SEATED_STATES } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { setupComplete } from '../lib/contact';
import { resolveSession, touchLastSeen, SESSION_MAX_AGE_S, type Auth } from '../lib/sessions';
import { VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE_S, closedToVisitors, openPath, resolveVisitor, visitorUser } from '../lib/visitors';
import { openWhileLocked } from '../lib/screen-time';

export const SESSION_COOKIE = 'anti_session';
export type CookieJar = Record<string, Cookie<unknown>>;

/**
 * Who is asking: a member (session cookie or bearer token), else a visitor (RFC §10.8, the
 * `anti_visitor` cookie), else nobody. A member always wins over a visitor cookie in the same
 * browser, and the visitor cookie is dropped. A visitor cookie whose pass has ended or was revoked
 * is dropped too, and the request fails as `visitor_expired` so the app can show the ended page
 * (except on the paths that let them enter a new code, sign in or join).
 */
export function authPlugin(deps: Deps, seed?: unknown) {
  return new Elysia({ name: 'auth', seed }).derive({ as: 'global' }, async ({ headers, cookie, request }) => {
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
      // RFC §10.10: the half hour is spent; only the lock screen, the timer and signing out answer (admins are never locked)
      if (auth?.lockedUntil && auth.user.role !== 'ops' && auth.lockedUntil.getTime() > Date.now()) {
        const path = new URL(request.url).pathname;
        if (!openWhileLocked(path)) throw new ApiError(403, 'rest_time', auth.lockedUntil.toISOString());
      }
    }
    const vtoken = (cookie as CookieJar)[VISITOR_COOKIE]?.value;
    if (typeof vtoken === 'string' && vtoken) {
      const path = new URL(request.url).pathname;
      if (auth) clearVisitorCookie(cookie as CookieJar);
      else {
        const pass = await resolveVisitor(deps.db, vtoken);
        if (pass) {
          if (closedToVisitors(path)) throw new ApiError(403, 'visitor_readonly', 'Visitors can only watch.');
          auth = { user: visitorUser(), tokenHash: '', visitor: pass };
        } else {
          clearVisitorCookie(cookie as CookieJar);
          if (!openPath(path)) throw new ApiError(401, 'visitor_expired', 'Your hour is up.');
        }
      }
    }
    return { auth };
  });
}

/** A signed-in member. Visitors (RFC §10.8) are turned away: everything behind this is theirs alone. */
export function requireUser(auth: Auth | null): Auth {
  if (!auth) throw new ApiError(401, 'unauthenticated');
  if (auth.visitor) throw new ApiError(403, 'visitor_readonly', 'Visitors can only watch.');
  return auth;
}

/**
 * A member with a seat who has finished setup (RFC §10.3): About you, gender, birthday, and contact
 * details for admins (§10.7, while CONTACT_KEY is set). Until
 * then everything a seat gives is locked; /me, /me/setup, settings and sign-out still work.
 * A visitor (RFC §10.8) passes too: they read what a seated member reads, and only read.
 */
export function requireSeated(auth: Auth | null): Auth {
  if (auth?.visitor) return auth;
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

export function setVisitorCookie(cookie: CookieJar, token: string, secure: boolean) {
  cookie[VISITOR_COOKIE]!.set({ value: token, httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: VISITOR_COOKIE_MAX_AGE_S });
}

export function clearVisitorCookie(cookie: CookieJar) {
  cookie[VISITOR_COOKIE]!.set({ value: '', path: '/', maxAge: 0 });
}
