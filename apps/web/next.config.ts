import type { NextConfig } from 'next';

const config: NextConfig = {
  // A second dev server (e.g. the screenshot stack) needs its own build dir: NEXT_DIST_DIR=.next-shots
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@anti/shared'],
  async rewrites() {
    const api = process.env.API_URL ?? 'http://localhost:3001';
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
};

export default config;
