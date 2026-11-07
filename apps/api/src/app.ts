import { Elysia } from 'elysia';
import type { Deps } from './deps';
import { ApiError } from './lib/errors';
import { SESSION_COOKIE } from './plugins/auth';
import { authRoutes } from './routes/auth';
import { inviteRoutes } from './routes/invites';
import { meRoutes } from './routes/me';
import { postRoutes } from './routes/posts';
import { socialRoutes } from './routes/social';

export function createApp(deps: Deps) {
  return new Elysia()
    .onRequest(({ request }) => {
      // CSRF: cookie-bearing state-changing requests must come from our web origin.
      if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
      const origin = request.headers.get('origin');
      const cookies = request.headers.get('cookie') ?? '';
      if (origin && cookies.includes(`${SESSION_COOKIE}=`) && origin !== deps.cfg.webOrigin) {
        return new ApiError(403, 'bad_origin', 'Origin not allowed.').toResponse();
      }
    })
    .onError({ as: 'global' }, ({ error, code, set }) => {
      if (error instanceof ApiError) {
        set.status = error.status;
        return { error: error.code, ...(error.detail ? { detail: error.detail } : {}) };
      }
      if (code === 'VALIDATION' || code === 'PARSE') {
        set.status = 400;
        return { error: 'bad_request', detail: 'Invalid request body.' };
      }
      if (code === 'NOT_FOUND') {
        set.status = 404;
        return { error: 'not_found' };
      }
      console.error(error);
      set.status = 500;
      return { error: 'internal_error' };
    })
    .get('/health', () => ({ ok: true }))
    .use(inviteRoutes(deps))
    .use(authRoutes(deps))
    .use(meRoutes(deps))
    .use(postRoutes(deps))
    .use(socialRoutes(deps));
}

export type App = ReturnType<typeof createApp>;
