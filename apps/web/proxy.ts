/**
 * Content-Security-Policy with a fresh nonce per request (see node_modules/next/dist/docs/01-app/
 * 02-guides/content-security-policy.md). Next.js reads the nonce from this header and puts it on
 * its own scripts; any other script, inline or from another site, is refused by the browser. That
 * is what makes an injected <script> useless even if some text slipped through unescaped.
 *
 * - script-src: only nonced scripts, plus what they load ('strict-dynamic'); eval only in dev.
 * - style-src keeps 'unsafe-inline': React writes style="" attributes, which nonces can't cover.
 *   Styles can't run code, so this is the usual trade-off.
 * - everything else (fetches, images, fonts, frames, forms) comes from this site only; the API is
 *   same-origin through the /api proxy, uploads preview as blob: URLs (images, and a monologue's
 *   recording before it is posted: media-src).
 * Pages render per request so each gets its own nonce (the root layout awaits connection()).
 */
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const https = request.nextUrl.protocol === 'https:';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    // RFC §10.22: a recording you just made or picked plays from a blob: URL before it is posted
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // only on https: on plain http (local builds) it would rewrite every request to https
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // pages only: not the API proxy, static files, the service worker or icons
      source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|sw.js).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
