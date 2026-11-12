import { Elysia, t } from 'elysia';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { createCard, deleteCard, getFile, listMyCards, reorderPages, setPage, updateCard } from '../lib/file';
import { authPlugin, requireSeated } from '../plugins/auth';

/**
 * RFC §10.24, the File.
 * GET    /members/:handle/file        the drawer: 12 pages, each with its card or empty
 * GET    /me/file/cards               your own cards, placed or not
 * POST   /me/file/cards               make a card for yourself ({ page } puts it on that page)
 * PATCH  /me/file/cards/:id           change a card you made; `photos` replaces the whole list
 * DELETE /me/file/cards/:id
 * PUT    /me/file/pages/:position     { label?, cardId? } rename a page / put a card on it / take it off
 * POST   /me/file/pages/order         { order } your own pages 1–6 in their new order
 * Photos come from POST /uploads (same pipeline as posts) and are attached by id.
 */
export const fileRoutes = (deps: Deps) => {
  const { db, storage } = deps;
  const photo = t.Object({ id: t.String({ maxLength: 40 }), caption: t.Optional(t.String({ maxLength: 600 })) });
  const fields = {
    headline: t.Optional(t.String({ maxLength: 400 })),
    description: t.Optional(t.String({ maxLength: 6000 })),
    photos: t.Optional(t.Array(photo, { maxItems: 50 })),
  };
  return new Elysia()
    .use(authPlugin(deps))

    .get('/members/:handle/file', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const file = await getFile(db, a.user.id, params.handle);
      if (!file) throw new ApiError(404, 'not_found');
      return file;
    })

    .get('/me/file/cards', async ({ auth }) => {
      const a = requireSeated(auth);
      return { items: await listMyCards(db, a.user.id) };
    })

    .post('/me/file/cards', async ({ auth, body }) => {
      const a = requireSeated(auth);
      return createCard(db, a.user.id, body as Record<string, unknown>);
    }, { body: t.Object({ ...fields, page: t.Optional(t.Nullable(t.Number())) }) })

    .patch('/me/file/cards/:id', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      return updateCard(db, storage, a.user.id, params.id, body as Record<string, unknown>);
    }, { body: t.Object(fields) })

    .delete('/me/file/cards/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      await deleteCard(db, storage, a.user.id, params.id);
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
