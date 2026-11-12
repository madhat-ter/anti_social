/**
 * RFC §10.24: a member's File for anyone with its link: no sign-in, no feed, nothing else of anti.
 * Only when the member switched sharing on (Settings → File); otherwise this says it is not shared.
 * Pasted into a chat or a profile it previews with the member's name and the first photo of the
 * "Me" card; search engines are asked not to list it.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { PublicFile } from './PublicFile';

type Shared = { owner: { displayName: string }; pages: { card: { headline: string; photos: { url: string }[] } | null }[] };

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const robots = { index: false, follow: false };
  try {
    const api = process.env.API_URL ?? 'http://localhost:3001';
    const r = await fetch(`${api}/public/file/${encodeURIComponent(handle)}`, { cache: 'no-store' });
    if (!r.ok) return { title: 'File · anti', robots };
    const f = (await r.json()) as Shared;
    const first = f.owner.displayName.split(/\s+/)[0] || f.owner.displayName;
    const title = `${first}’s File · anti`;
    const me = f.pages[0]?.card ?? f.pages.find((p) => p.card)?.card ?? null;
    const description = me ? me.headline : 'A drawer of cards, on anti: a small, invite-only network.';
    const h = await headers();
    const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
    const image = me?.photos[0] ? `${origin}${me.photos[0].url}` : null;
    return {
      title, description, robots,
      openGraph: { title, description, type: 'profile', ...(image ? { images: [{ url: image }] } : {}) },
      twitter: { card: image ? 'summary_large_image' : 'summary', title, description, ...(image ? { images: [image] } : {}) },
    };
  } catch {
    return { title: 'File · anti', robots };
  }
}

export default async function SharedFilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <PublicFile handle={decodeURIComponent(handle)} />;
}
