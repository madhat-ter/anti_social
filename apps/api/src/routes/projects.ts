import { Elysia, t } from 'elysia';
import { PROJECTS_MAX } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { createProject, deleteProject, getProject, listProjects, reorderProjects, updateProject } from '../lib/projects';
import { authPlugin, requireSeated } from '../plugins/auth';

/**
 * GET    /members/:handle/projects         the contents list (drafts only for the owner)
 * GET    /members/:handle/projects/:id     one project with its images
 * POST   /me/projects                      create (fields + images, up to 12 projects)
 * PATCH  /me/projects/:id                  change fields; `images` replaces the whole list when given
 * DELETE /me/projects/:id
 * POST   /me/projects/order                { ids } in the new order
 * Images come from POST /uploads (same pipeline as posts) and are attached by id.
 */
export const projectRoutes = (deps: Deps) => {
  const { db, storage } = deps;
  const imageInput = t.Object({
    id: t.String({ maxLength: 40 }),
    layout: t.Optional(t.String({ maxLength: 10 })),
    heading: t.Optional(t.String({ maxLength: 400 })),
    text: t.Optional(t.String({ maxLength: 3000 })),
    caption: t.Optional(t.String({ maxLength: 600 })),
  });
  const fields = {
    title: t.Optional(t.String({ maxLength: 400 })),
    summary: t.Optional(t.String({ maxLength: 1000 })),
    body: t.Optional(t.String({ maxLength: 20000 })),
    year: t.Optional(t.Nullable(t.Union([t.Number(), t.String({ maxLength: 10 })]))),
    role: t.Optional(t.String({ maxLength: 400 })),
    tools: t.Optional(t.Array(t.String({ maxLength: 200 }), { maxItems: 50 })),
    team: t.Optional(t.String({ maxLength: 400 })),
    duration: t.Optional(t.String({ maxLength: 400 })),
    draft: t.Optional(t.Boolean()),
    images: t.Optional(t.Array(imageInput, { maxItems: 50 })),
  };
  return new Elysia()
    .use(authPlugin(deps))

    .get('/members/:handle/projects', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const items = await listProjects(db, a.user.id, params.handle);
      if (!items) throw new ApiError(404, 'not_found');
      return { items };
    })

    .get('/members/:handle/projects/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const p = await getProject(db, a.user.id, params.handle, params.id);
      if (!p) throw new ApiError(404, 'not_found');
      return p;
    })

    .post('/me/projects', async ({ auth, body }) => {
      const a = requireSeated(auth);
      return createProject(db, storage, a.user.id, body as Record<string, unknown>, PROJECTS_MAX);
    }, { body: t.Object(fields) })

    .post('/me/projects/order', async ({ auth, body }) => {
      const a = requireSeated(auth);
      await reorderProjects(db, a.user.id, body.ids);
      return { ok: true };
    }, { body: t.Object({ ids: t.Array(t.String({ maxLength: 40 }), { maxItems: 50 }) }) })

    .patch('/me/projects/:id', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      return updateProject(db, storage, a.user.id, params.id, body as Record<string, unknown>);
    }, { body: t.Object(fields) })

    .delete('/me/projects/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      await deleteProject(db, storage, a.user.id, params.id);
      return { ok: true };
    });
};
