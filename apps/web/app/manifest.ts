import type { MetadataRoute } from 'next';

/**
 * RFC §10.31: makes "Add to Home Screen" open anti as an app of its own. On iPhone that is the only
 * way a website may send notifications (iOS 16.4+), so without this file the feed's ask could not
 * work there. Light colours: anti is light unless a member picks dark (§10.14).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'anti',
    short_name: 'anti',
    description: 'A small community of 100 seats, for when you feel alone.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}
