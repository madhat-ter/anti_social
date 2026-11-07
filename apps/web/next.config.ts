import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@anti/shared'],
  async rewrites() {
    const api = process.env.API_URL ?? 'http://localhost:3001';
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
};

export default config;
