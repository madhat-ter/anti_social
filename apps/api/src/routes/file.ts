import { Elysia, t } from 'elysia';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import {
  addGuestCard, checkGuestCard, createCard, declineCard, deleteCard, getFile, getPublicFile, isPublicFilePhoto, listMade, listMyCards, listTray,
  reorderPages, sendCard, setPage, updateCard, type GuestPhoto,
} from '../lib/file';
import { clientIp, hit } from '../lib/ratelimit';
import { isValidKey } from '../lib/storage';
import { authPlugin, requireSeated } from '../plugins/auth';
import { imageToWebp, mediaResponse } from './posts';

/**
 * RFC §10.24, the File.
 * GET    /members/:handle/file        the drawer: 12 pages, each with its card or empty
 * GET    /me/file/cards               your own cards, placed or not
 * POST   /me/file/cards               make a card for yourself ({ page } puts it on that page)
 * PATCH  /me/file/cards/:id           change a card you made; `photos` replaces the whole list
 * DELETE /me/file/cards/:id
 * PUT    /me/file/pages/:position     { label?, cardId? } rename a page / put a card on it / take it off
 * POST   /me/file/pages/order         { order } your own pages 1–6 in their new order
 * Cards made for someone (a card with `forHandle` is your draft until sent):
 * POST   /me/file/cards/:id/send      hand it over: it waits in their tray
 * GET    /me/file/made                cards you made for others
 * GET    /me/file/tray                cards others made for you, waiting for your yes
 * POST   /me/file/tray/:id/decline    turn one down (its maker is never told)
 * The share link (no sign-in; only when the member switched it on in Settings):
 * GET    /public/file/:handle               the File as the outside may see it
 * GET    /public/file/:handle/media/:key    one of its photos, and nothing else
 * POST   /public/file/:handle/cards         a card from someone outside (multipart: name, headline,
 *                                           description, captions, 1–5 photos); 3 an hour per IP
 * Photos come from POST /uploads (same pipeline as posts) and are attached by id.
 */
export const fileRoutes = (deps: Deps) => {
  const { db, storage } = deps;
  const photo = t.Object({ id: t.String({ maxLength: 40 }), caption: t.Optional(t.String({ maxLength: 600 })) });
  const fields = {
    headline: t.Optional(t.String({ maxLength: 400 })),
    description: t.Optional(t.String({ maxLength: 6000 })),
    photos: t.Optional(t.Array(photo, { maxItems: 50 })),
    publicOk: t.Optional(t.Boolean()),
  };
  return new Elysia()
    .use(authPlugin(deps))

    .get('/members/:handle/file', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const ops = !a.visitor && a.user.role === 'ops';
      const file = await getFile(db, a.user.id, params.handle, { ops });
      if (!file) throw new ApiError(404, 'not_found');
      // an admin may remove any card but their own making (that one they just delete)
      return ops ? { ...file, pages: file.pages.map((p) => (p.card ? { ...p, card: { ...p.card, canModerate: !p.card.mine } } : p)) } : file;
    })

    // RFC §10.24: the share link. No session: anyone with the link, if the member shares their File.
    .get('/public/file/:handle', async ({ params, set }) => {
      const file = await getPublicFile(db, params.handle);
      if (!file) throw new ApiError(404, 'not_found');
      set.headers['x-robots-tag'] = 'noindex';
      return file;
    })

    .get('/public/file/:handle/media/:key', async ({ params, request }) => {
      if (!isValidKey(params.key) || !(await isPublicFilePhoto(db, params.handle, params.key))) throw new ApiError(404, 'not_found');
      const f = await storage.get(params.key);
      if (!f) throw new ApiError(404, 'not_found');
      return mediaResponse(f.bytes, f.contentType, request.headers.get('range'));
    })

    // RFC §10.24: a card from someone outside anti, made on the share page. No account: a typed
    // name, up to five photos, sent in one go. It lands in the member's private tray like any
    // card made for them. Nothing is kept unless everything is right.
    .post('/public/file/:handle/cards', async ({ params, body, request, server }) => {
      const b = body as Record<string, unknown>;
      // the trap: a field people never see. A robot that fills it is thanked and nothing is kept.
      if (typeof b.website === 'string' && b.website.trim()) return { ok: true };
      const files = (Array.isArray(b.photos) ? b.photos : b.photos ? [b.photos] : [])
        .filter((f): f is File => !!f && typeof (f as File).arrayBuffer === 'function');
      const input = await checkGuestCard(db, params.handle, b, files.length);
      try {
        await hit(db, 'guestCard', clientIp(request, server as Parameters<typeof clientIp>[1], deps.cfg.trustProxy ?? false));
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) {
          throw new ApiError(429, 'rate_limited', 'Three cards an hour can be sent from one internet connection. Try again in a while.');
        }
        throw e;
      }
      const stored: GuestPhoto[] = [];
      try {
        for (const f of files) {
          const out = await imageToWebp(f);
          const key = `${crypto.randomUUID()}.webp`;
          await storage.put(key, new Uint8Array(out.data), 'image/webp');
          stored.push({ key, width: out.info.width, height: out.info.height });
        }
        await addGuestCard(db, input, stored);
      } catch (e) {
        await Promise.all(stored.map((s) => storage.delete(s.key).catch(() => {})));
        throw e;
      }
      return { ok: true };
    }, {
      body: t.Object({
        name: t.Optional(t.Any()), headline: t.Optional(t.Any()), description: t.Optional(t.Any()),
        captions: t.Optional(t.Any()), photos: t.Optional(t.Any()), website: t.Optional(t.Any()),
      }),
    })

    .get('/me/file/cards', async ({ auth }) => {
      const a = requireSeated(auth);
      return { items: await listMyCards(db, a.user.id) };
    })

    .post('/me/file/cards', async ({ auth, body }) => {
      const a = requireSeated(auth);
      return createCard(db, a.user.id, body as Record<string, unknown>);
    }, { body: t.Object({ ...fields, page: t.Optional(t.Nullable(t.Number())), forHandle: t.Optional(t.Nullable(t.String({ maxLength: 60 }))) }) })

    .patch('/me/file/cards/:id', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      return updateCard(db, storage, a.user.id, params.id, body as Record<string, unknown>);
    }, { body: t.Object(fields) })

    .delete('/me/file/cards/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      await deleteCard(db, storage, a.user.id, params.id);
      return { ok: true };
    })

    .post('/me/file/cards/:id/send', async ({ auth, params }) => {
      const a = requireSeated(auth);
      return sendCard(db, a.user.id, params.id);
    })

    .get('/me/file/made', async ({ auth }) => {
      const a = requireSeated(auth);
      return { items: await listMade(db, a.user.id) };
    })

    .get('/me/file/tray', async ({ auth }) => {
      const a = requireSeated(auth);
      return { items: await listTray(db, a.user.id) };
    })

    .post('/me/file/tray/:id/decline', async ({ auth, params }) => {
      const a = requireSeated(auth);
      await declineCard(db, storage, a.user.id, params.id);
      return { ok: true };
    })

    .post('/me/file/pages/order', async ({ auth, body }) => {
      const a = requireSeated(auth);
      await reorderPages(db, a.user.id, body.order);
      return { ok: true };
    }, { body: t.Object({ order: t.Array(t.Number(), { maxItems: 20 }) }) })

    .put('/me/file/pages/:position', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      await setPage(db, a.user.id, Number(params.position), body);
      return { ok: true };
    }, { body: t.Object({ label: t.Optional(t.String({ maxLength: 200 })), cardId: t.Optional(t.Nullable(t.String({ maxLength: 40 }))) }) });
};
