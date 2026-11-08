import { Elysia, t } from 'elysia';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { mergePortfolio, portfolioByHandle, portfolioByUser, savePortfolio } from '../lib/portfolio';
import { authPlugin, requireSeated } from '../plugins/auth';

/**
 * GET  /members/:handle/portfolio   a member's portfolio (all fields, `empty` when nothing is filled in)
 * PATCH /me/portfolio               set any of the CV fields or the look; omitted fields keep their value.
 *                                   `coverId`: a pending upload to use as the cover, or null to remove it.
 * Seated members only. Archived members' portfolios stay readable, like their posts.
 */
export const portfolioRoutes = (deps: Deps) => {
  const { db, storage } = deps;
  const entry = t.Object({
    title: t.Optional(t.String({ maxLength: 400 })),
    place: t.Optional(t.String({ maxLength: 400 })),
    from: t.Optional(t.Union([t.Number(), t.String({ maxLength: 10 })])),
    to: t.Optional(t.Nullable(t.Union([t.Number(), t.String({ maxLength: 10 })]))),
    line: t.Optional(t.String({ maxLength: 600 })),
  });
  return new Elysia()
    .use(authPlugin(deps))

    .get('/members/:handle/portfolio', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const p = await portfolioByHandle(db, a.user.id, params.handle);
      if (!p) throw new ApiError(404, 'not_found');
      return p;
    })

    .patch('/me/portfolio', async ({ auth, body }) => {
      const a = requireSeated(auth);
      const current = await portfolioByUser(db, a.user.id);
      const { coverId, ...rest } = body;
      return savePortfolio(db, storage, a.user.id, mergePortfolio(current, rest as Record<string, unknown>), coverId);
    }, {
      body: t.Object({
        headline: t.Optional(t.String({ maxLength: 400 })),
        location: t.Optional(t.String({ maxLength: 400 })),
        openToWork: t.Optional(t.Boolean()),
        about: t.Optional(t.String({ maxLength: 5000 })),
        skills: t.Optional(t.Array(t.String({ maxLength: 200 }), { maxItems: 100 })),
        tools: t.Optional(t.Array(t.String({ maxLength: 200 }), { maxItems: 100 })),
        experience: t.Optional(t.Array(entry, { maxItems: 50 })),
        education: t.Optional(t.Array(entry, { maxItems: 50 })),
        links: t.Optional(t.Array(t.Object({
          label: t.Optional(t.String({ maxLength: 200 })), url: t.Optional(t.String({ maxLength: 2000 })),
        }), { maxItems: 50 })),
        font: t.Optional(t.String({ maxLength: 20 })),
        bg: t.Optional(t.String({ maxLength: 20 })),
        accent: t.Optional(t.String({ maxLength: 20 })),
        coverId: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
      }),
    });
};
