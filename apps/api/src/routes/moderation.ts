import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';
import { scalar } from '@anti/db';
import { formatInviteCode } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { generateInviteCode } from '../lib/crypto';
import {
  banUser, flagCollab, flagPost, flagProject, flagQueue, removeCollab, removePost, removeProject, resolveCollabFlags, resolveFlags,
  resolveProjectFlags, userIdByHandle,
} from '../lib/moderation';
import { opsConsultation, opsConsultations, resolveConsultationFlags, resolveOfferFlags, switchOff, switchOn } from '../lib/consultations';
import { adminMembers, getAdminSettings, renameMember, setMemberBirthday, setMemberRole, unbanMember, updateAdminSettings } from '../lib/admin';
import { UUID_RE } from '../lib/posts';
import { hit } from '../lib/ratelimit';
import { authPlugin, requireSeated, requireUser } from '../plugins/auth';
import type { Auth } from '../lib/sessions';

/**
 * Ops = the site's admins (moderators). They use these endpoints from the Admin page (and the
 * ops CLI). To members the endpoints do not exist: 404.
 */
function requireOps(auth: Auth | null): Auth {
  const a = requireUser(auth);
  if (a.user.role !== 'ops') throw new ApiError(404, 'not_found');
  return a;
}

export const moderationRoutes = (deps: Deps) => {
  const { db, storage } = deps;
  return new Elysia()
    .use(authPlugin(deps))

    .post('/posts/:id/flag', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      await hit(db, 'flag', a.user.id);
      const r = await flagPost(db, a.user.id, params.id, body?.reason);
      return { flagged: r.flagged }; // whether it is now hidden is not the reporter's business
    }, { body: t.Optional(t.Object({ reason: t.Optional(t.String({ maxLength: 800 })) })) })

    .post('/projects/:id/flag', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      await hit(db, 'flag', a.user.id);
      const r = await flagProject(db, a.user.id, params.id, body?.reason);
      return { flagged: r.flagged };
    }, { body: t.Optional(t.Object({ reason: t.Optional(t.String({ maxLength: 800 })) })) })

    .post('/collabs/:id/flag', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      await hit(db, 'flag', a.user.id);
      return flagCollab(db, a.user.id, params.id, body?.reason);
    }, { body: t.Optional(t.Object({ reason: t.Optional(t.String({ maxLength: 800 })) })) })

    .post('/ops/collabs/:id/resolve', async ({ auth, params, body }) => {
      requireOps(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      return resolveCollabFlags(db, params.id, body.resolution);
    }, { body: t.Object({ resolution: t.Union([t.Literal('restored'), t.Literal('removed')]) }) })

    .post('/ops/collabs/:id/remove', async ({ auth, params }) => {
      const a = requireOps(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      return removeCollab(db, params.id, a.user.id);
    })

    // ─── Consultations (RFC §10.6) ───
    .get('/ops/consultations', async ({ auth }) => {
      requireOps(auth);
      return opsConsultations(db);
    })
    .get('/ops/consultations/:id', async ({ auth, params }) => {
      requireOps(auth);
      return opsConsultation(db, params.id);
    })
    .post('/ops/consultations/:id/resolve', async ({ auth, params, body }) => {
      const a = requireOps(auth);
      return resolveConsultationFlags(db, params.id, body.resolution, a.user.id);
    }, { body: t.Object({ resolution: t.Union([t.Literal('restored'), t.Literal('removed')]) }) })
    .post('/ops/consult-offers/:handle/resolve', async ({ auth, params, body }) => {
      const a = requireOps(auth);
      const u = await userIdByHandle(db, params.handle);
      return resolveOfferFlags(db, u.id, body.resolution, a.user.id);
    }, { body: t.Object({ resolution: t.Union([t.Literal('restored'), t.Literal('removed')]) }) })
    .post('/ops/users/:handle/consulting', async ({ auth, params, body }) => {
      const a = requireOps(auth);
      const u = await userIdByHandle(db, params.handle);
      return body.on ? switchOn(db, u.id) : switchOff(db, u.id, a.user.id);
    }, { body: t.Object({ on: t.Boolean() }) })

    .get('/ops/flags', async ({ auth }) => {
      requireOps(auth);
      return flagQueue(db);
    })

    .post('/ops/projects/:id/resolve', async ({ auth, params, body }) => {
      requireOps(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      return resolveProjectFlags(db, storage, params.id, body.resolution);
    }, { body: t.Object({ resolution: t.Union([t.Literal('restored'), t.Literal('removed')]) }) })

    .post('/ops/flags/:postId/resolve', async ({ auth, params, body }) => {
      requireOps(auth);
      if (!UUID_RE.test(params.postId)) throw new ApiError(404, 'not_found');
      return resolveFlags(db, storage, params.postId, body.resolution);
    }, { body: t.Object({ resolution: t.Union([t.Literal('restored'), t.Literal('removed')]) }) })

    .post('/ops/users/:handle/ban', async ({ auth, params }) => {
      const a = requireOps(auth);
      return banUser(db, params.handle.replace(/^@/, ''), a.user.id);
    })

    .post('/ops/users/:handle/unban', async ({ auth, params }) => {
      const a = requireOps(auth);
      return unbanMember(db, params.handle, a.user.id);
    })

    .post('/ops/users/:handle/role', async ({ auth, params, body }) => {
      const a = requireOps(auth);
      return setMemberRole(db, params.handle, body.role, a.user.id);
    }, { body: t.Object({ role: t.Union([t.Literal('ops'), t.Literal('member')]) }) })

    .post('/ops/users/:handle/handle', async ({ auth, params, body }) => {
      const a = requireOps(auth);
      return renameMember(db, params.handle, body.handle, a.user.id);
    }, { body: t.Object({ handle: t.String({ maxLength: 40 }) }) })

    .post('/ops/users/:handle/birthday', async ({ auth, params, body }) => {
      const a = requireOps(auth);
      return setMemberBirthday(db, storage, params.handle, body.birthday, !!body.confirmUnderage, a.user.id);
    }, { body: t.Object({ birthday: t.String({ maxLength: 20 }), confirmUnderage: t.Optional(t.Boolean()) }) })

    .get('/ops/members', async ({ auth }) => {
      requireOps(auth);
      return adminMembers(db);
    })

    .post('/ops/posts/:id/remove', async ({ auth, params }) => {
      const a = requireOps(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      return removePost(db, storage, params.id, a.user.id);
    })

    .post('/ops/projects/:id/remove', async ({ auth, params }) => {
      const a = requireOps(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      return removeProject(db, storage, params.id, a.user.id);
    })

    .get('/ops/settings', async ({ auth }) => {
      requireOps(auth);
      return getAdminSettings(db);
    })

    .patch('/ops/settings', async ({ auth, body }) => {
      requireOps(auth);
      return updateAdminSettings(db, body);
    }, {
      body: t.Object({
        seatCap: t.Optional(t.Number()),
        invitesPerMember: t.Optional(t.Number()),
        inviteExpiryDays: t.Optional(t.Number()),
      }),
    })

    .post('/ops/invites', async ({ auth, body }) => {
      requireOps(auth);
      const codes: { code: string; expiresAt: string }[] = [];
      for (let i = 0; i < body.count; i++) {
        const code = generateInviteCode();
        const exp = await scalar<string | Date>(db, sql`select create_invite(null, ${code})`);
        codes.push({ code: formatInviteCode(code), expiresAt: new Date(exp as string).toISOString() });
      }
      return codes;
    }, { body: t.Object({ count: t.Integer({ minimum: 1, maximum: 50 }) }) });
};
