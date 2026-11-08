import { Elysia, t } from 'elysia';
import type { Deps } from '../deps';
import {
  collabUpdates, createCollab, decideRequest, declineInvite, deleteCollab, getCollab, inviteMember, joinCollab, leaveCollab,
  listCollabs, memberCollabs, removeFromTeam, setTeamRole, suggestPeople, updateCollab, withdrawRequest,
} from '../lib/collabs';
import { authPlugin, requireSeated } from '../plugins/auth';

/** Collabs (RFC §10.5). All the rules live in lib/collabs.ts; these are thin handlers. */
export const collabRoutes = (deps: Deps) => {
  const { db, storage } = deps;
  const handle = t.Object({ id: t.String(), handle: t.String({ maxLength: 40 }) });
  return new Elysia()
    .use(authPlugin(deps))

    .get('/collabs', async ({ auth, query }) => {
      const a = requireSeated(auth);
      const tab = query.tab === 'all' ? 'all' : 'for-you';
      return { items: await listCollabs(db, a.user.id, { tab, interest: query.interest || undefined }) };
    }, { query: t.Object({ tab: t.Optional(t.String()), interest: t.Optional(t.String({ maxLength: 40 })) }) })

    .post('/collabs', async ({ auth, body }) => {
      const a = requireSeated(auth);
      return createCollab(db, storage, a.user.id, body as Record<string, unknown>);
    }, { body: t.Record(t.String(), t.Unknown()) })

    .get('/collabs/:id', async ({ auth, params }) => getCollab(db, requireSeated(auth).user.id, params.id))

    .patch('/collabs/:id', async ({ auth, params, body }) =>
      updateCollab(db, storage, requireSeated(auth).user.id, params.id, body as Record<string, unknown>),
    { body: t.Record(t.String(), t.Unknown()) })

    .delete('/collabs/:id', async ({ auth, params }) => deleteCollab(db, requireSeated(auth).user.id, params.id))

    .post('/collabs/:id/join', async ({ auth, params, body }) =>
      joinCollab(db, requireSeated(auth).user.id, params.id, body?.note),
    { body: t.Optional(t.Object({ note: t.Optional(t.String({ maxLength: 2000 })) })) })

    .delete('/collabs/:id/request', async ({ auth, params }) => withdrawRequest(db, requireSeated(auth).user.id, params.id))

    .post('/collabs/:id/requests/:handle/accept', async ({ auth, params }) =>
      decideRequest(db, requireSeated(auth).user.id, params.id, params.handle, true), { params: handle })
    .post('/collabs/:id/requests/:handle/decline', async ({ auth, params }) =>
      decideRequest(db, requireSeated(auth).user.id, params.id, params.handle, false), { params: handle })

    .get('/collabs/:id/suggestions', async ({ auth, params }) => suggestPeople(db, requireSeated(auth).user.id, params.id))

    .post('/collabs/:id/invites', async ({ auth, params, body }) =>
      inviteMember(db, requireSeated(auth).user.id, params.id, body.handle.replace(/^@/, '')),
    { body: t.Object({ handle: t.String({ maxLength: 40 }) }) })

    /** Accepting an invite is joining. */
    .post('/collabs/:id/invite/accept', async ({ auth, params }) => joinCollab(db, requireSeated(auth).user.id, params.id, undefined))
    .post('/collabs/:id/invite/decline', async ({ auth, params }) => declineInvite(db, requireSeated(auth).user.id, params.id))

    .post('/collabs/:id/leave', async ({ auth, params }) => leaveCollab(db, requireSeated(auth).user.id, params.id))

    .post('/collabs/:id/members/:handle/role', async ({ auth, params, body }) =>
      setTeamRole(db, requireSeated(auth).user.id, params.id, params.handle, body.role),
    { params: handle, body: t.Object({ role: t.Union([t.Literal('cohost'), t.Literal('member')]) }) })

    .delete('/collabs/:id/members/:handle', async ({ auth, params }) =>
      removeFromTeam(db, requireSeated(auth).user.id, params.id, params.handle), { params: handle })

    /** The updates thread (RFC §10.5): the team posts with POST /posts { collabId }, anyone replies. */
    .get('/collabs/:id/updates', async ({ auth, params, query }) => collabUpdates(db, requireSeated(auth).user.id, params.id, query),
    { query: t.Object({ cursor: t.Optional(t.String()), limit: t.Optional(t.String()) }) })

    .get('/members/:handle/collabs', async ({ auth, params }) =>
      ({ items: await memberCollabs(db, requireSeated(auth).user.id, params.handle) }),
    { params: t.Object({ handle: t.String({ maxLength: 40 }) }) });
};
