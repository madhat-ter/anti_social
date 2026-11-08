import { Elysia, t } from 'elysia';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { authPlugin } from '../plugins/auth';
import { screenBeat, screenState } from '../lib/screen-time';

/**
 * RFC §10.10: the member's half hour. `GET` reads it (and opens a fresh one when the rest is over);
 * `POST beat` adds the seconds the page was visible since the last beat. Visitors have no row:
 * their hour is the pass (RFC §10.8).
 */
export const screenTimeRoutes = (deps: Deps) =>
  new Elysia({ prefix: '/me/screen-time' })
    .use(authPlugin(deps, 'screen-time'))
    .get('/', async ({ auth }) => {
      if (!auth) throw new ApiError(401, 'unauthenticated');
      if (auth.visitor) throw new ApiError(403, 'visitor_readonly', 'Visitors can only watch.');
      return screenState(deps.db, auth.user.id);
    })
    .post('/beat', async ({ auth, body }) => {
      if (!auth) throw new ApiError(401, 'unauthenticated');
      if (auth.visitor) throw new ApiError(403, 'visitor_readonly', 'Visitors can only watch.');
      return screenBeat(deps.db, auth.user.id, body.seconds);
    }, { body: t.Object({ seconds: t.Number({ minimum: 0, maximum: 3600 }) }) });
