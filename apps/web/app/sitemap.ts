import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/about';

/**
 * RFC §10.29: the pages meant to be found. Only the landing page: everything else is a member's,
 * behind sign-in, or a member's share page (/f/<handle>), which stays out of search on purpose.
 * lastModified is when the landing's words last changed; move it when they change again.
 */
const LANDING_CHANGED = new Date('2026-11-23T00:00:00Z');

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, lastModified: LANDING_CHANGED, changeFrequency: 'monthly', priority: 1 }];
}
