/**
 * RFC §10.29: what anti is, said plainly for people who find it through search, and for search
 * engines and AI assistants that quote it. One source for the words on the landing page, the
 * structured data (JSON-LD) and /llms.txt, so they never disagree.
 *
 * The owner's rules for this text (2026-11-23): describe what anti really is (a small community for
 * people who feel alone), never use suicide or self-harm words, say plainly that anti is not a
 * crisis service but give no phone number (§10.25), and say joining is free.
 */
export const SITE_URL = 'https://tryanti.social';
export const SITE_NAME = 'anti';

/** 50–60 characters: the search result's headline */
export const HOME_TITLE = 'anti: a small, invite-only community for when you feel alone';
/** 150–160 characters: the search result's line under the headline */
export const HOME_DESCRIPTION =
  'You may feel there’s no one for you. anti is a small online community of 100 seats where people who feel alone find each other. Free to join, by invite.';

/** "What is anti?": three sentences that stand on their own when quoted */
export const ABOUT_LINES = [
  'anti is a small online community with a hundred seats, for anyone 13 or older who feels like there’s no one for them.',
  'Members post, reply, share short recordings and meet up at events, in one feed that is never ranked.',
  'You join with an invite from a member, or by asking for a seat on this page.',
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Who is anti for?',
    a: 'Anyone 13 or older who feels alone, or like they don’t fit anywhere, and wants a small place where people know their name.',
  },
  {
    q: 'How do I join anti?',
    a: 'With an invite from someone inside. If you don’t know anyone here, use “Ask for a seat” on this page: an admin reads it and gets back to you.',
  },
  {
    q: 'Is anti free?',
    a: 'Yes. Joining is free, and there are no ads.',
  },
  {
    q: 'Who can see what I post?',
    a: 'Only members: everything inside needs signing in with your handle and a PIN. There are no private messages, so everything is said where everyone can see. Your File page is shown outside only if you switch sharing on.',
  },
  {
    q: 'Is anti a crisis service?',
    a: 'No. anti is a room of people, not a counsellor or a crisis service. If you are not safe right now, tell someone near you whom you trust, or call your local emergency number.',
  },
];
