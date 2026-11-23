import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/about';

/**
 * RFC §10.29: search engines and AI assistants may read the public pages. Members' pages are behind
 * sign-in and noindex (layout.tsx), so they show nothing; the API and dev pages are closed outright.
 * A bot named in a group of its own ignores the '*' group, so every group repeats the same rules.
 */
const RULES = { allow: '/', disallow: ['/api/', '/dev/'] };
const NAMED = [
  'Googlebot', 'Bingbot', 'Google-Extended',
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User', 'Applebot', 'Applebot-Extended',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: NAMED, ...RULES }, { userAgent: '*', ...RULES }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
