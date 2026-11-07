import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { NoPushSender } from '../lib/push';
import { authPlugin, requireUser } from '../plugins/auth';

export const pushRoutes = (deps: Deps) => {
  const { db } = deps;
  const push = deps.push ?? new NoPushSender();
  return new Elysia()
    .use(authPlugin(deps))
    .get('/push/config', () => ({ enabled: !!push.publicKey, publicKey: push.publicKey }))

    // Upsert by endpoint: a browser re-subscribing (or a shared device changing accounts) moves the row.
    .post('/push/subscriptions', async ({ auth, body }) => {
      const a = requireUser(auth);
      if (!push.publicKey) throw new ApiError(409, 'push_disabled', 'Push notifications are not configured on this server.');
      let u: URL;
      try { u = new URL(body.endpoint); } catch { throw new ApiError(400, 'bad_request', 'Invalid endpoint.'); }
      if (u.protocol !== 'https:') throw new ApiError(400, 'bad_request', 'Push endpoints must be https.');
      await db.execute(sql`
        insert into push_subscriptions(user_id, platform, endpoint, keys)
        values (${a.user.id}::uuid, 'webpush', ${body.endpoint}, ${JSON.stringify(body.keys)}::jsonb)
        on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys`);
      return { ok: true };
    }, {
      body: t.Object({
        endpoint: t.String({ maxLength: 1000 }),
        keys: t.Object({ p256dh: t.String({ maxLength: 200 }), auth: t.String({ maxLength: 100 }) }),
      }),
    })

    .delete('/push/subscriptions', async ({ auth, body }) => {
      const a = requireUser(auth);
      await db.execute(sql`delete from push_subscriptions where endpoint = ${body.endpoint} and user_id = ${a.user.id}::uuid`);
      return { ok: true };
    }, { body: t.Object({ endpoint: t.String({ maxLength: 1000 }) }) });
};
