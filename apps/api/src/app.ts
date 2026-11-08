import { Elysia } from 'elysia';
import type { Deps } from './deps';
import { ApiError } from './lib/errors';
import { clientIp, hit } from './lib/ratelimit';
import { SESSION_COOKIE } from './plugins/auth';
import { authRoutes } from './routes/auth';
import { inviteRoutes } from './routes/invites';
import { meRoutes } from './routes/me';
import { postRoutes } from './routes/posts';
import { socialRoutes } from './routes/social';
import { paymentRoutes } from './routes/payments';
import { eventRoutes } from './routes/events';
import { moderationRoutes } from './routes/moderation';
import { pushRoutes } from './routes/push';
import { suggestionRoutes } from './routes/suggestions';
import { portfolioRoutes } from './routes/portfolio';
import { projectRoutes } from './routes/projects';
import { interestRoutes } from './routes/interests';
import { collabRoutes } from './routes/collabs';
import { consultationRoutes } from './routes/consultations';
import { visitRoutes } from './routes/visit';
import { VISITOR_COOKIE, openPath } from './lib/visitors';

export function createApp(deps: Deps) {
  return new Elysia()
    .onRequest(async ({ request, server }) => {
      // CSRF: cookie-bearing state-changing requests must come from our web origin.
      if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
      const origin = request.headers.get('origin');
      const cookies = request.headers.get('cookie') ?? '';
      const hasSession = cookies.includes(`${SESSION_COOKIE}=`);
      const hasVisitor = cookies.includes(`${VISITOR_COOKIE}=`);
      if (origin && (hasSession || hasVisitor) && origin !== deps.cfg.webOrigin) {
        return new ApiError(403, 'bad_origin', 'Origin not allowed.').toResponse();
      }
      const path = new URL(request.url).pathname;
      // Visitors (RFC §10.8) only watch: nothing that writes reaches a handler. Entering a code,
      // leaving, signing in and joining still work (a member session in the same browser wins).
      if (hasVisitor && !hasSession && !openPath(path)) {
        return new ApiError(403, 'visitor_readonly', 'Visitors can only watch.').toResponse();
      }
      // Per-IP limits on unauthenticated endpoints (RFC §13).
      const limit = path === '/invites/check' || path === '/visit' ? 'inviteCheck' : path.startsWith('/auth/') && path !== '/auth/logout' ? 'auth' : null;
      if (limit) {
        try {
          await hit(deps.db, limit, clientIp(request, server, deps.cfg.trustProxy ?? false));
        } catch (e) {
          if (e instanceof ApiError) return e.toResponse();
          throw e;
        }
      }
    })
    .onAfterHandle({ as: 'global' }, ({ set }) => {
      // Media and JSON are served from here: never sniff, never leak the URL onward.
      set.headers['x-content-type-options'] = 'nosniff';
      set.headers['referrer-policy'] = 'no-referrer';
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
    .use(visitRoutes(deps))
    .use(authRoutes(deps))
    .use(meRoutes(deps))
    .use(postRoutes(deps))
    .use(socialRoutes(deps))
    .use(paymentRoutes(deps))
    .use(eventRoutes(deps))
    .use(moderationRoutes(deps))
    .use(pushRoutes(deps))
    .use(suggestionRoutes(deps))
    .use(portfolioRoutes(deps))
    .use(projectRoutes(deps))
    .use(interestRoutes(deps))
    .use(collabRoutes(deps))
    .use(consultationRoutes(deps));
}

export type App = ReturnType<typeof createApp>;
