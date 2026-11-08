import { Elysia, t } from 'elysia';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { openPass } from '../lib/visitors';
import { authPlugin, clearVisitorCookie, setVisitorCookie, type CookieJar } from '../plugins/auth';

/**
 * Visitor passes (RFC §10.8), the visitor's side. Entering a code starts the hour and sets the
 * `anti_visitor` cookie; the admin's side is under /ops in moderation.ts. Per-IP rate limited in
 * app.ts like the invite checker, so codes cannot be guessed.
 */
export const visitRoutes = (deps: Deps) =>
  new Elysia({ prefix: '/visit' })
    .use(authPlugin(deps))

    /** A member never needs a pass: the code is left untouched for whoever it was meant for. */
    .post('/', async ({ auth, body, cookie }) => {
      if (auth && !auth.visitor) throw new ApiError(409, 'already_member', 'You are already a member. No pass needed.');
      const { token, expiresAt } = await openPass(deps.db, body.code);
      setVisitorCookie(cookie as CookieJar, token, deps.cfg.cookieSecure);
      return { expiresAt: expiresAt.toISOString() };
    }, { body: t.Object({ code: t.String({ maxLength: 32 }) }) })

    /** Leaving early. The pass stays used up: a code never works twice. */
    .post('/leave', ({ cookie }) => {
      clearVisitorCookie(cookie as CookieJar);
      return { ok: true as const };
    });
