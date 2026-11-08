import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';
import { scalar } from '@anti/db';
import { formatInviteCode } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { generateInviteCode } from '../lib/crypto';
import { banUser, flagPost, flagProject, flagQueue, resolveFlags, resolveProjectFlags } from '../lib/moderation';
import { UUID_RE } from '../lib/posts';
import { hit } from '../lib/ratelimit';
import { authPlugin, requireSeated, requireUser } from '../plugins/auth';
import type { Auth } from '../lib/sessions';

/** Ops is a backend role (RFC §2): no UI, just these endpoints and the ops CLI. Unknown to members → 404. */
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
      return banUser(db, params.handle, a.user.id);
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
