import { Elysia, t } from 'elysia';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { clientIp, hit } from '../lib/ratelimit';
import { addSeatRequest, checkSeatRequest, declineSeatRequest, inviteSeatRequest, listSeatRequests, seatRequestsOpen } from '../lib/seat-requests';
import { authPlugin } from '../plugins/auth';
import type { Auth } from '../lib/sessions';

/** To members, as to anyone, the admin side does not exist: 404. */
function requireOps(auth: Auth | null): Auth {
  if (!auth) throw new ApiError(401, 'unauthenticated');
  if (auth.user.role !== 'ops') throw new ApiError(404, 'not_found');
  return auth;
}

/**
 * Asking for a seat (RFC §10.25).
 *
 * GET  /public/seat-requests              is the form on? (it needs the contact key)
 * POST /public/seat-requests              a request from the landing page; no session
 * GET  /ops/seat-requests                 admins: who is waiting, who was invited
 * POST /ops/seat-requests/:id/invite      make an invite for them (the code is shown once)
 * POST /ops/seat-requests/:id/decline     "Not now": the request is erased
 */
export const seatRoutes = (deps: Deps) => {
  const { db } = deps;
  const text = (max: number) => t.Optional(t.String({ maxLength: max }));
  return new Elysia()
    .use(authPlugin(deps))

    .get('/public/seat-requests', () => ({ open: seatRequestsOpen() }))

    .post('/public/seat-requests', async ({ body, request, server }) => {
      // the trap: a field people never see. A robot that fills it is thanked and nothing is kept.
      if (body.website?.trim()) return { ok: true as const };
      const input = checkSeatRequest(body);
      try {
        await hit(db, 'seatRequest', clientIp(request, server as Parameters<typeof clientIp>[1], deps.cfg.trustProxy ?? false));
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) {
          throw new ApiError(429, 'rate_limited', 'Three requests an hour can be sent from one internet connection. Try again in a while.');
        }
        throw e;
      }
      await addSeatRequest(db, input);
      return { ok: true as const };
    }, { body: t.Object({ name: text(400), contact: text(400), note: text(4000), website: text(400) }) })

    .get('/ops/seat-requests', async ({ auth }) => {
      requireOps(auth);
      return listSeatRequests(db);
    })
    .post('/ops/seat-requests/:id/invite', async ({ auth, params }) => {
      const a = requireOps(auth);
      return inviteSeatRequest(db, params.id, a.user.id);
    })
    .post('/ops/seat-requests/:id/decline', async ({ auth, params }) => {
      requireOps(auth);
      return declineSeatRequest(db, params.id);
    });
};
