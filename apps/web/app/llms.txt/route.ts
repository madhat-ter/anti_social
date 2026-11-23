import { ABOUT_LINES, FAQ, HOME_DESCRIPTION, SITE_URL } from '@/lib/about';

/**
 * RFC §10.29: /llms.txt, a short Markdown page for AI assistants (llmstxt.org), built from the same
 * words as the landing page so the two never disagree.
 */
export function GET() {
  const text = [
    '# anti',
    '',
    `> ${HOME_DESCRIPTION}`,
    '',
    ...ABOUT_LINES,
    '',
    '## Key facts',
    '',
    '- A hundred seats in all, so members know each other. Someone away for 30 days passes their seat to someone waiting.',
    '- One feed, never ranked: likes don’t move posts, and the feed has an end.',
    '- No private messages: everything is said where everyone can see.',
    '- Members can post, reply, record short audio (“monologues”), keep a File of cards, and host or join events, activities and projects.',
    '- Joining is free. Sign-in is a handle and a 6-digit PIN; no email or social login.',
    '- anti is not a crisis service.',
    '',
    '## Questions',
    '',
    ...FAQ.flatMap(({ q, a }) => [`### ${q}`, '', a, '']),
    '## Pages',
    '',
    `- [Home](${SITE_URL}/): what anti is, the seats, and "Ask for a seat"`,
    `- [Join with an invite](${SITE_URL}/join)`,
    `- [Sign in](${SITE_URL}/login)`,
    '',
  ].join('\n');
  return new Response(text, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
}
