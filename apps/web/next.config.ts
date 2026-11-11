import type { NextConfig } from 'next';

const config: NextConfig = {
  // A second dev server (e.g. the screenshot stack) needs its own build dir: NEXT_DIST_DIR=.next-shots
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@anti/shared'],
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
      { source: '/events/new', destination: '/collab/new?kind=event', permanent: true },
      { source: '/events/:id/edit', destination: '/collab/event/:id/edit', permanent: true },
      { source: '/events/:id', destination: '/collab/event/:id', permanent: true },
      { source: '/events', destination: '/collab?kind=event', permanent: true },
      { source: '/collabs/new', destination: '/collab/new', permanent: true },
      { source: '/collabs/:id/edit', destination: '/collab/:id/edit', permanent: true },
      { source: '/collabs/:id', destination: '/collab/:id', permanent: true },
      { source: '/collabs', destination: '/collab', permanent: true },
    ];
  },
};

export default config;
