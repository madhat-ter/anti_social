import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // A second dev server (e.g. the screenshot stack) needs its own build dir: NEXT_DIST_DIR=.next-shots
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // cPanel package (scripts/build-cpanel.ts): a self-contained copy that runs on plain Node.js
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone' as const, outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)) }
    : {}),
  transpilePackages: ['@anti/shared'],
  // don't tell every visitor which framework (and so which known bugs) to try
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=()' },
      ],
    }];
  },
  async rewrites() {
    const api = process.env.API_URL ?? 'http://localhost:3001';
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
  // RFC §10.21: Events and Collabs became one place. Old addresses keep working, permanently.
  async redirects() {
    return [
      // RFC §10.27: the test site moved to tryanti.social (2026-11-23). Every address on the old
      // host, the API included, goes to the same address there. Temporary (307), so browsers don't
      // remember it for ever if the old host is ever needed again.
      {
        source: '/:path*',
        has: [{ type: 'host' as const, value: 'anti-social-opal.vercel.app' }],
        destination: 'https://tryanti.social/:path*',
        permanent: false,
      },
      { source: '/events/new', destination: '/collab/new?kind=event', permanent: true },
      { source: '/events/:id/edit', destination: '/collab/event/:id/edit', permanent: true },
      { source: '/events/:id', destination: '/collab/event/:id', permanent: true },
      { source: '/events', destination: '/collab?kind=event', permanent: true },
      { source: '/collabs/new', destination: '/collab/new', permanent: true },
      { source: '/collabs/:id/edit', destination: '/collab/:id/edit', permanent: true },
      { source: '/collabs/:id', destination: '/collab/:id', permanent: true },
      { source: '/collabs', destination: '/collab', permanent: true },
      // RFC §10.26: search is the box on Members; the query string (?q=) travels with the forward
      { source: '/search', destination: '/members', permanent: true },
    ];
  },
};

export default config;
