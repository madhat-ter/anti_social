import { Elysia, t } from 'elysia';
import type { Deps } from '../deps';
import {
  acceptRequest, agreeToPrice, allThanks, closeConsultation, createRequest, declineRequest, flagConsultation, flagOffer, getConsultation,
  getMyOffer, getOffer, hideThanks, listConsultations, markDone, saveMyOffer, setThanks, waitingCount,
} from '../lib/consultations';
import { hit } from '../lib/ratelimit';
import { authPlugin, requireSeated } from '../plugins/auth';

/** Consultations (RFC §10.6). The rules live in lib/consultations.ts; these are thin handlers. */
export const consultationRoutes = (deps: Deps) => {
  const { db } = deps;
  const anyBody = { body: t.Record(t.String(), t.Unknown()) };
  const handle = t.Object({ handle: t.String({ maxLength: 40 }) });
  const reason = { body: t.Optional(t.Object({ reason: t.Optional(t.String({ maxLength: 800 })) })) };
  return new Elysia()
    .use(authPlugin(deps))

    .get('/me/consult-offer', async ({ auth }) => getMyOffer(db, requireSeated(auth).user))
    .put('/me/consult-offer', async ({ auth, body }) => saveMyOffer(db, requireSeated(auth).user, body as Record<string, unknown>), anyBody)

    /** null when there is nothing to show you (no offer, paused, or under 18 on either side) */
    .get('/members/:handle/consult-offer', async ({ auth, params }) =>
      ({ offer: await getOffer(db, requireSeated(auth).user, params.handle) }), { params: handle })
    .get('/members/:handle/consult-thanks', async ({ auth, params }) => allThanks(db, requireSeated(auth).user, params.handle), { params: handle })
    .post('/members/:handle/consultations', async ({ auth, params, body }) =>
      createRequest(db, requireSeated(auth).user, params.handle, body as Record<string, unknown>), { params: handle, ...anyBody })
    .post('/members/:handle/consult-offer/flag', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      await hit(db, 'flag', a.user.id);
      return flagOffer(db, a.user, params.handle, body?.reason);
    }, { params: handle, ...reason })

    .get('/consultations', async ({ auth, query }) =>
      listConsultations(db, requireSeated(auth).user, query.box === 'sent' ? 'sent' : 'received'),
    { query: t.Object({ box: t.Optional(t.String()) }) })
    .get('/consultations/waiting', async ({ auth }) => ({ waiting: await waitingCount(db, requireSeated(auth).user.id) }))
    .get('/consultations/:id', async ({ auth, params }) => getConsultation(db, requireSeated(auth).user, params.id))
    .post('/consultations/:id/accept', async ({ auth, params, body }) =>
      acceptRequest(db, requireSeated(auth).user, params.id, (body ?? {}) as Record<string, unknown>), { body: t.Optional(t.Record(t.String(), t.Unknown())) })
    .post('/consultations/:id/decline', async ({ auth, params }) => declineRequest(db, requireSeated(auth).user, params.id))
    .post('/consultations/:id/agree', async ({ auth, params }) => agreeToPrice(db, requireSeated(auth).user, params.id))
    .post('/consultations/:id/close', async ({ auth, params }) => closeConsultation(db, requireSeated(auth).user, params.id))
    .post('/consultations/:id/done', async ({ auth, params }) => markDone(db, requireSeated(auth).user, params.id))
    .put('/consultations/:id/thanks', async ({ auth, params, body }) =>
      setThanks(db, requireSeated(auth).user, params.id, body.text), { body: t.Object({ text: t.Union([t.String({ maxLength: 2000 }), t.Null()]) }) })
    .post('/consultations/:id/thanks/hidden', async ({ auth, params, body }) =>
      hideThanks(db, requireSeated(auth).user, params.id, body.hidden), { body: t.Object({ hidden: t.Boolean() }) })
    .post('/consultations/:id/flag', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      await hit(db, 'flag', a.user.id);
      return flagConsultation(db, a.user, params.id, body?.reason);
    }, reason);
};
